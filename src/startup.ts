import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STARTUP_DIR = join(
  process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
);
const STARTUP_FILE = join(STARTUP_DIR, "ILIAS Sync.cmd");
const LOG_PATH = join(homedir(), ".config", "ilias-sync", "ilias-sync.log");

export async function installStartup(): Promise<{ startupFile: string; logPath: string }> {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = join(projectDir, "dist", "cli.js");
  const executable = process.execPath;
  const packaged = isPackagedExecutable(executable);
  if (!packaged) {
    await access(cli).catch(() => {
      throw new Error(`${cli} not found — run \`npm run build\` first.`);
    });
  }

  await mkdir(STARTUP_DIR, { recursive: true });
  await mkdir(dirname(LOG_PATH), { recursive: true });
  const command = buildStartupCommand({
    executable,
    cli,
    projectDir,
    logPath: LOG_PATH,
    packaged,
  });
  await writeFile(STARTUP_FILE, command, "utf8");
  return { startupFile: STARTUP_FILE, logPath: LOG_PATH };
}

export async function uninstallStartup(): Promise<void> {
  await rm(STARTUP_FILE, { force: true });
}

export function buildStartupCommand(options: {
  executable: string;
  cli: string;
  projectDir: string;
  logPath: string;
  packaged: boolean;
}): string {
  const launch = options.packaged
    ? `${quote(options.executable)} watch`
    : `${quote(options.executable)} ${quote(options.cli)} watch`;
  const workingDirectory = options.packaged ? "" : `cd /d ${quote(options.projectDir)}\r\n`;
  const log = quote(options.logPath);

  return [
    "@echo off",
    "setlocal",
    ":retry",
    workingDirectory.trimEnd(),
    `${launch} >> ${log} 2>&1`,
    "if not errorlevel 1 exit /b 0",
    `>> ${log} echo Startup process exited with code %errorlevel%. Retrying in 60 seconds...`,
    "timeout /t 60 /nobreak >nul",
    "goto retry",
    "",
  ].filter((line) => line.length > 0).join("\r\n");
}

function isPackagedExecutable(executable: string): boolean {
  return process.platform === "win32" && /\.exe$/i.test(executable) &&
    !/^node(?:js)?\.exe$/i.test(basename(executable));
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
