#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkbox, confirm, input, password as passwordPrompt } from "@inquirer/prompts";
import { Command } from "commander";
import { type Config, CONFIG_PATH, loadConfig, saveConfig } from "./config.js";
import { Daemon, log, syncAll } from "./daemon.js";
import { IliasClient } from "./ilias/client.js";
import { installStartup, uninstallStartup } from "./startup.js";
import { deletePassword, getPassword, setPassword } from "./keychain.js";
import { parseSemester } from "./ilias/parse.js";
import { isDaemonRunning, startControlServer } from "./server.js";
import { sanitizeName } from "./sync/fsnames.js";

const DEFAULT_BASE_URL = "https://ilias3.uni-stuttgart.de/";

const expandHome = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));

async function requirePassword(config: Config): Promise<string> {
  const pw = await getPassword(config.baseUrl, config.username);
  if (pw) return pw;
  if (!process.stdin.isTTY) throw new Error("No password in Windows Credential Manager. Run `ilias-sync setup` first.");
  return passwordPrompt({ message: `ILIAS password for ${config.username}:`, mask: true });
}

async function chooseCourses(config: Config, pw: string): Promise<Config["courses"]> {
  const client = new IliasClient(config.baseUrl, config.username, pw);
  await client.login();
  const available = await client.courses();
  const current = new Map(config.courses.map((c) => [c.refId, c]));

  const selected = await checkbox({
    message: "Which courses should be synced? (space = toggle, enter = confirm)",
    pageSize: 20,
    choices: available.map((c) => ({
      name: `${c.title}${c.group ? `  (${parseSemester(c.group)?.label ?? c.group})` : ""}`,
      value: c,
      checked: current.has(c.refId),
    })),
  });
  if (selected.length === 0) return [];

  const existingRoot = config.courses[0] ? resolve(config.courses[0].targetDir, "..") : join(homedir(), "ILIAS");
  const root = expandHome(await input({ message: "Base folder for course downloads:", default: existingRoot }));
  const perCourse = await confirm({ message: "Choose a separate folder for each course?", default: false });

  const videoChoice = await checkbox({
    message: "Download lecture recordings (Opencast, ~500 MB each) for which courses?",
    choices: selected.map((c) => ({ name: c.title, value: c.refId, checked: current.get(c.refId)?.videos ?? true })),
  });

  const out: Config["courses"] = [];
  for (const c of selected) {
    const fallback = current.get(c.refId)?.targetDir ?? join(root, sanitizeName(c.title));
    const targetDir = perCourse ? expandHome(await input({ message: `Folder for "${c.title}":`, default: fallback })) : fallback;
    out.push({ refId: c.refId, title: c.title, targetDir, videos: videoChoice.includes(c.refId) });
  }
  return out;
}

const program = new Command("ilias-sync").description("Mirror your ILIAS courses to a local folder");

program.command("setup").description("Log in, store credentials in Windows Credential Manager and pick courses").action(async () => {
  const existing = await loadConfig().catch(() => undefined);
  const baseUrl = await input({ message: "ILIAS URL:", default: existing?.baseUrl ?? DEFAULT_BASE_URL });
  const username = await input({ message: "ILIAS username:", default: existing?.username });
  const pw = await passwordPrompt({ message: "ILIAS password:", mask: true });

  const config: Config = {
    baseUrl, username,
    intervalMinutes: existing?.intervalMinutes ?? 30,
    concurrency: existing?.concurrency ?? 3,
    courses: existing?.courses ?? [],
  };
  config.courses = await chooseCourses(config, pw); // also verifies the login
  await setPassword(baseUrl, username, pw);
  await saveConfig(config);
  console.log(`Saved ${config.courses.length} course(s) to ${CONFIG_PATH}. Password stored in Windows Credential Manager.`);
});

program.command("courses").description("Change which courses are synced").action(async () => {
  const config = await loadConfig();
  config.courses = await chooseCourses(config, await requirePassword(config));
  await saveConfig(config);
  console.log(`Now syncing ${config.courses.length} course(s).`);
});

program.command("sync").description("Run one sync pass")
  .option("-n, --dry-run", "only show what would be downloaded")
  .option("-c, --course <text>", "only sync courses whose title contains <text>")
  .option("--no-videos", "skip lecture recordings this time")
  .action(async (opts: { dryRun?: boolean; course?: string; videos: boolean }) => {
    const config = await loadConfig();
    await syncAll(config, await requirePassword(config), { dryRun: opts.dryRun, filter: opts.course, videos: opts.videos });
  });

program.command("watch").description("Keep running and sync periodically (and after wake-up)")
  .option("-i, --interval <minutes>", "minutes between checks")
  .action(async (opts: { interval?: string }) => {
    // The tray app and the Startup entry may both try to start the daemon at login.
    if (await isDaemonRunning()) {
      log("Background sync is already running.");
      return;
    }
    // Runs even without a config so local clients can complete setup via the control API.
    const daemon = new Daemon(undefined, undefined, opts.interval ? Number(opts.interval) : undefined);
    const { port } = await startControlServer(daemon);
    log(`Background sync started (control API on 127.0.0.1:${port}).`);
    await daemon.run();
  });

program.command("install").description("Run the background sync at Windows login").action(async () => {
  await loadConfig(); // make sure setup has been done
  const { startupFile, logPath } = await installStartup();
  console.log(`Installed ${startupFile}. Start ilias-sync with \`ilias-sync watch\` now, then at the next Windows login.`);
  console.log(`Log: ${logPath}`);
});

program.command("uninstall").description("Stop running at Windows login").action(async () => {
  await uninstallStartup();
  console.log("Windows Startup entry removed.");
});

program.command("logout").description("Remove the stored password from Windows Credential Manager").action(async () => {
  const config = await loadConfig();
  await deletePassword(config.baseUrl, config.username);
  console.log("Password removed from Windows Credential Manager.");
});

program.parseAsync().catch((err: Error) => {
  if (err.name === "ExitPromptError") process.exit(130);
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
