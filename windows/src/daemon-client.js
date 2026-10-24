import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_DIR = process.env.ILIAS_SYNC_CONFIG_DIR ?? join(homedir(), ".config", "ilias-sync");
export const LOG_PATH = join(CONFIG_DIR, "ilias-sync.log");
/** The ilias-sync checkout this app lives in; its compiled CLI runs the background job. */
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_PATH = join(REPO_DIR, "dist", "cli.js");

export class NotRunningError extends Error {
  constructor() {
    super("The background sync is not running.");
  }
}

/** Re-read on every call: the port and token change whenever the background job restarts. */
async function info() {
  try {
    return JSON.parse(await readFile(join(CONFIG_DIR, "daemon.json"), "utf8"));
  } catch {
    throw new NotRunningError();
  }
}

/** Talks to the control API of the background job on 127.0.0.1. */
export async function request(method, path, body, { timeoutMs = 60_000 } = {}) {
  const { port, token } = await info();
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      // Logging in and listing courses goes through ILIAS, which can be slow.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED") throw new NotRunningError();
    if (err.name === "TimeoutError") throw new Error("The background sync did not respond in time.");
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Stops a running background job (if any) and starts `ilias-sync watch` detached from this app. */
export async function restartBackgroundJob() {
  await access(CLI_PATH).catch(() => {
    throw new Error(`${CLI_PATH} not found. Run "npm run build" in ${REPO_DIR} first.`);
  });
  const running = await request("GET", "/api/status", undefined, { timeoutMs: 2000 }).then(() => true, () => false);
  if (running) {
    const { pid } = await info();
    try { process.kill(pid); } catch { /* already gone */ }
  }

  await mkdir(CONFIG_DIR, { recursive: true });
  const log = openSync(LOG_PATH, "a");
  try {
    const child = spawn("node", [CLI_PATH, "watch"], {
      cwd: REPO_DIR,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (err) => reject(err.code === "ENOENT" ? new Error("Node.js was not found on PATH.") : err));
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}
