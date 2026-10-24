# ilias-sync

`ilias-sync` mirrors selected ILIAS courses into local Windows folders. It
downloads course files, exercise sheets, and optionally Opencast recordings,
then keeps local copies up to date.

## Requirements

- Windows 10 or newer
- Node.js 20 or newer
- An ILIAS account with access to the courses to sync

## Install and configure

From PowerShell in this repository:

```powershell
npm install
npm run build
node dist\cli.js setup
```

`setup` verifies the login, lets you select courses and target folders, and
stores the password in **Windows Credential Manager**. The course configuration
is stored at:

```text
%USERPROFILE%\.config\ilias-sync\config.json
```

You can use the development command instead of the compiled CLI while working
on the project:

```powershell
npm run dev -- setup
```

## Commands

```powershell
node dist\cli.js sync --dry-run       # show changes without downloading
node dist\cli.js sync                 # run one sync pass
node dist\cli.js sync --no-videos     # skip recordings for this pass
node dist\cli.js courses              # change selected courses
node dist\cli.js watch                # run continuously every 30 minutes
node dist\cli.js logout               # remove the saved password
```

Use `--course "part of title"` to sync only matching courses. The interval and
download concurrency are stored in the config file.

## Run automatically at Windows login

After setup and a build:

```powershell
node dist\cli.js install
```

This creates a per-user command file in the Windows Startup folder. It starts
the background `watch` process when you sign in and writes its log to:

```text
%USERPROFILE%\.config\ilias-sync\ilias-sync.log
```

Remove automatic startup with:

```powershell
node dist\cli.js uninstall
```

The background process exposes a local, token-protected control API on
`127.0.0.1`. Its temporary connection information is kept in:

```text
%USERPROFILE%\.config\ilias-sync\daemon.json
```

## Tray app

The `windows` directory contains a system-tray app, the Windows counterpart of
the macOS menu-bar app. It shows the sync status in the notification area,
opens a flyout with recent files and course folders when clicked, and has a
Windows 11–style settings window for the account, courses and interval. It
talks to the background `watch` process and starts it if it is not running.

```powershell
npm run build          # the tray app runs dist\cli.js
cd windows
npm install
npm start
```

Right-click the tray icon for the classic menu. Under **Settings › General**,
turn on **Start ILIAS Sync when I sign in** to launch it at login; you then
don't need `install`. If you keep both, they won't run two background
processes: `watch` exits if one is already running.

## How it works

1. `setup` logs in to ILIAS and discovers the courses available on the
   dashboard.
2. `sync` crawls each selected course and follows supported folders,
   exercises, sessions, and Opencast series.
3. Downloaded files are written into the configured course folders. Each
   course has a `.ilias-sync-state.json` file containing the ILIAS metadata
   used to detect unchanged files.
4. When ILIAS reports a changed file, the previous local copy is kept with its
   old date in the filename before the new copy is written.
5. `watch` repeats the process on the configured interval and retries after
   transient failures. `install` only arranges for `watch` to start at login;
   it does not duplicate the crawler.

Forums, web links, and course links are intentionally not synchronized.
Recordings are opt-in per course and can be skipped for an individual run
with `--no-videos`.

## Development

```powershell
npm test
npm run typecheck
npm run build
```

The `macos` directory is retained as historical source from the original
project. The Swift menu-bar application is not part of the Windows build; the
`windows` tray app replaces it.
