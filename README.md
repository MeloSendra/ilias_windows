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

After setup and a build (or after installing the packaged `.exe`):

```powershell
node dist\cli.js install       # Node/source installation
ilias-sync.exe install        # packaged installation
```

This creates a per-user command file in the Windows Startup folder. It starts
the background `watch` process when you sign in. Packaged installations launch
the `.exe` directly; source installations launch Node with `dist\cli.js`.
The launcher retries after an unexpected process exit and writes its output to:

```text
%USERPROFILE%\.config\ilias-sync\ilias-sync.log
```

Remove automatic startup with:

```powershell
node dist\cli.js uninstall
```

To verify the registration, run `shell:startup` from the Windows Run dialog
and check for `ILIAS Sync.cmd`. After signing in, inspect the log if the
process is not running:

```powershell
Get-Content "$HOME\.config\ilias-sync\ilias-sync.log" -Tail 50
```

If the log says that `dist\cli.js` is missing, rebuild before installing
startup with `npm run build`. For a packaged installation, reinstall startup
using the packaged executable's `install` command so the launcher points to
the `.exe` rather than a development directory.

The background process exposes a local, token-protected control API on
`127.0.0.1`. Its temporary connection information is kept in:

```text
%USERPROFILE%\.config\ilias-sync\daemon.json
```

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
project. This fork targets the Windows CLI and Windows background startup
workflow; the Swift menu-bar application is not part of the Windows build.
