// Shared by the main process (tray tooltip, context menu) and the flyout window.

function time(iso) {
  const date = new Date(iso);
  const opts = { hour: "2-digit", minute: "2-digit" };
  if (date.toDateString() !== new Date().toDateString()) opts.weekday = "short";
  return date.toLocaleString(undefined, opts);
}

/** "offline" | "idle" | "syncing" | "paused" | "error" — selects the tray icon. */
export function iconState(status) {
  if (!status) return "offline";
  if (status.state === "needs-setup") return "error";
  return status.state;
}

export function headline(status, error) {
  if (!status) return error ?? "Connecting…";
  switch (status.state) {
    case "syncing": return "Syncing…";
    case "paused": return "Paused";
    case "needs-setup": return "Setup needed";
    case "error": return "Last sync failed";
  }
  const run = status.lastRun;
  if (!run) return "Waiting for first sync";
  const changes = run.added + run.updated;
  return `Last sync ${time(run.finishedAt)} · ${changes === 0 ? "nothing new" : `${changes} new/updated`}`;
}

export function nextRunText(status) {
  return status?.nextRun ? `Next check at ${time(status.nextRun)}` : undefined;
}

/** Splits "Course/sub/dir/file.pdf" into the file name and where it lives. */
export function splitLabel(label) {
  const i = label.lastIndexOf("/");
  return i < 0 ? { name: label, where: "" } : { name: label.slice(i + 1), where: label.slice(0, i).replaceAll("/", " › ") };
}
