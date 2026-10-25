import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Config, CONFIG_DIR, ConfigSchema, loadConfig, saveConfig } from "./config.js";
import type { Daemon } from "./daemon.js";
import { IliasClient } from "./ilias/client.js";
import { getPassword, setPassword } from "./keychain.js";
import { parseSemester } from "./ilias/parse.js";
import { sanitizeName } from "./sync/fsnames.js";

/** Where local clients find the port and key of the running daemon. */
export const DAEMON_INFO_PATH = join(CONFIG_DIR, "daemon.json");

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const CredentialsSchema = z.object({
  baseUrl: z.url(),
  username: z.string().min(1),
  /** Omitted -> use the password stored in Windows Credential Manager. */
  password: z.string().min(1).optional(),
});

const SaveSchema = CredentialsSchema.extend({
  intervalMinutes: z.number().positive(),
  baseDir: z.string().optional(),
  courses: ConfigSchema.shape.courses,
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

async function resolvePassword(creds: z.infer<typeof CredentialsSchema>): Promise<string> {
  const pw = creds.password ?? (await getPassword(creds.baseUrl, creds.username));
  if (!pw) throw new HttpError(400, "Please enter your password.");
  return pw;
}

async function loggedInClient(creds: z.infer<typeof CredentialsSchema>): Promise<IliasClient> {
  const client = new IliasClient(creds.baseUrl, creds.username, await resolvePassword(creds));
  try {
    await client.login();
  } catch (err) {
    throw new HttpError(401, (err as Error).message);
  }
  return client;
}

/** True if another daemon is already answering on the port published in its info file. */
export async function isDaemonRunning(infoPath = DAEMON_INFO_PATH): Promise<boolean> {
  try {
    const { port, token } = JSON.parse(await readFile(infoPath, "utf8"));
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Local control API. Bound to 127.0.0.1 and protected by a random bearer token
 * stored in the per-user config directory.
 */
export async function startControlServer(daemon: Daemon, opts: { infoPath?: string } = {}): Promise<{ server: Server; port: number; token: string }> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);

  const routes: Record<string, (req: IncomingMessage) => Promise<unknown>> = {
    "GET /api/status": async () => daemon.getStatus(),
    "POST /api/sync": async () => (daemon.syncNow(), daemon.getStatus()),
    "POST /api/pause": async () => (daemon.pause(), daemon.getStatus()),
    "POST /api/resume": async () => (daemon.resume(), daemon.getStatus()),

    "GET /api/config": async () => {
      const config: Partial<Config> = await loadConfig().catch(() => ({}));
      const hasPassword = config.baseUrl && config.username
        ? !!(await getPassword(config.baseUrl, config.username))
        : false;
      return { configured: !!config.baseUrl, hasPassword, ...config };
    },

    "POST /api/test-login": async (req) => {
      await loggedInClient(parse(CredentialsSchema, await readJson(req)));
      return { ok: true };
    },

    "POST /api/courses": async (req) => {
      const client = await loggedInClient(parse(CredentialsSchema, await readJson(req)));
      const courses = await client.courses();
      return courses.map((c) => ({
        ...c,
        folderName: sanitizeName(c.title),
        groupLabel: parseSemester(c.group)?.label ?? c.group ?? "Other",
      }));
    },

    "PUT /api/config": async (req) => {
      const body = parse(SaveSchema, await readJson(req));
      if (body.password) {
        await loggedInClient(body); // verify before storing
        await setPassword(body.baseUrl, body.username, body.password);
      } else {
        await resolvePassword(body); // a new account/URL needs a password
      }
      const existing = await loadConfig().catch(() => undefined);
      const config = ConfigSchema.parse({
        baseUrl: body.baseUrl,
        username: body.username,
        intervalMinutes: body.intervalMinutes,
        concurrency: existing?.concurrency ?? 3,
        baseDir: body.baseDir,
        courses: body.courses,
      });
      await saveConfig(config);
      daemon.syncNow();
      return { ok: true };
    },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const auth = Buffer.from(req.headers.authorization ?? "");
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new HttpError(401, "Unauthorized");
      const route = routes[`${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`];
      if (!route) throw new HttpError(404, "Not found");
      send(200, await route(req));
    } catch (err) {
      send(err instanceof HttpError ? err.status : 500, { error: (err as Error).message });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const infoPath = opts.infoPath ?? DAEMON_INFO_PATH;
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(infoPath, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
  await chmod(infoPath, 0o600);
  const cleanup = () => rm(infoPath, { force: true }).finally(() => process.exit(0));
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  return { server, port, token };
}
