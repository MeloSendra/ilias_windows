import { APP_GLYPH, h, icon } from "./theme.js";
import { headline, nextRunText, splitLabel } from "../shared/format.js";

const $ = (id) => document.getElementById(id);
$("glyph").innerHTML = APP_GLYPH;

let current = { status: null, error: null };

function fileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["mp4", "mkv", "mov", "webm", "m4v"].includes(ext)) return 0xE714; // Video
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return 0xEB9F; // Photo
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return 0xF012; // Zip folder
  return 0xE8A5; // Document
}

function render() {
  const { status, error } = current;
  const running = !!status;
  const state = status?.state;

  $("headline").textContent = headline(status, error);
  $("next").textContent = nextRunText(status) ?? "";

  // Banner: not running, needs setup, or an error message from the last run.
  const banner = $("banner");
  const action = $("banner-action");
  let text = null;
  let critical = false;
  action.hidden = true;
  if (!running) {
    text = error ?? "The background sync is not running.";
    action.textContent = "Start";
    action.onclick = () => window.ilias.action("start-daemon");
    action.hidden = false;
  } else if (state === "needs-setup") {
    text = "Sign in and choose your courses to start syncing.";
    action.textContent = "Set up";
    action.onclick = () => window.ilias.action("settings");
    action.hidden = false;
  } else if (status.message) {
    text = status.message;
    critical = state === "error";
  }
  banner.hidden = !text;
  banner.classList.toggle("critical", critical);
  $("banner-text").textContent = text ?? "";

  const syncing = state === "syncing";
  $("sync").disabled = !running || syncing || state === "needs-setup";
  $("sync-label").textContent = syncing ? "Syncing…" : "Sync now";
  $("sync-icon").classList.toggle("spinning", syncing);

  const paused = state === "paused";
  $("pause").disabled = !running || state === "needs-setup";
  $("pause-label").textContent = paused ? "Resume" : "Pause";
  $("pause-icon").textContent = String.fromCodePoint(paused ? 0xE768 : 0xE769);

  const recent = status?.recent.slice(0, 6) ?? [];
  $("recent-section").hidden = recent.length === 0;
  $("recent").replaceChildren(...recent.map((file) => {
    const { name, where } = splitLabel(file.label);
    return h("li", {}, h("button", { title: file.path, onclick: () => window.ilias.open(file.path) },
      icon(fileIcon(name)),
      h("span.item-text", {}, h("span.item-name", {}, name), h("span.item-where", {}, where)),
      file.updated ? h("i.ico.badge", { title: "Updated" }, String.fromCodePoint(0xE72C)) : null,
    ));
  }));

  const courses = status?.courses ?? [];
  $("courses-section").hidden = courses.length === 0;
  $("courses").replaceChildren(...courses.map((course) =>
    h("li", {}, h("button", { title: course.targetDir, onclick: () => window.ilias.open(course.targetDir) },
      icon(0xE8B7),
      h("span.item-text", {}, h("span.item-name", {}, course.title)),
      icon(0xE8A7),
    ))));

  window.ilias.resizeFlyout(document.getElementById("root").scrollHeight);
}

$("settings").onclick = () => window.ilias.action("settings");
$("sync").onclick = () => window.ilias.action("sync");
$("pause").onclick = () => window.ilias.action(current.status?.state === "paused" ? "resume" : "pause");
$("log").onclick = () => window.ilias.action("show-log");
$("quit").onclick = () => window.ilias.action("quit");

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.ilias.action("hide-flyout");
});

window.ilias.onStatus((value) => { current = value; render(); });
window.ilias.on("shown", () => {
  const root = $("root");
  root.classList.remove("enter");
  void root.offsetWidth; // restart the animation
  root.classList.add("enter");
});
current = await window.ilias.status();
render();
