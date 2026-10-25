import { APP_GLYPH, h, icon } from "./theme.js";
import { headline, nextRunText } from "../shared/format.js";

const $ = (id) => document.getElementById(id);
$("glyph").innerHTML = APP_GLYPH;

const app = await window.ilias.info();

const model = {
  baseUrl: "https://ilias3.uni-stuttgart.de/",
  username: "",
  /** Empty means "keep the stored password". */
  password: "",
  hasPassword: false,
  intervalMinutes: 30,
  baseDir: `${app.homeDir}\\ILIAS`,
  /** Selected courses keyed by refId. */
  selected: new Map(),
  available: [],
  filter: "",
  busy: null,
  error: null,
  notice: null,
  saved: null,
};

// ---------- helpers ----------

function payload() {
  return {
    baseUrl: model.baseUrl,
    username: model.username,
    password: model.password || undefined,
    intervalMinutes: model.intervalMinutes,
    baseDir: model.baseDir,
    courses: [...model.selected.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
  };
}
const credentials = () => ({ baseUrl: model.baseUrl, username: model.username, password: model.password || undefined });
const isDirty = () => JSON.stringify(payload()) !== model.saved;

const joinPath = (dir, name) => `${dir.replace(/[\\/]+$/, "")}\\${name}`;
const parentDir = (path) => path.replace(/[\\/]+[^\\/]*$/, "");

function setPath(el, path) {
  // The left-to-right marks keep "C:\" in place while the row truncates from the left.
  el.textContent = `\u200E${path}\u200E`;
  el.title = path;
}

async function api(method, path, body) {
  const result = await window.ilias.api(method, path, body);
  if (result.error) throw new Error(result.notRunning
    ? "The background sync is not running. Start it from the tray icon or under General."
    : result.error);
  return result.data;
}

async function run(label, work) {
  model.busy = label;
  model.error = model.notice = null;
  renderChrome();
  try {
    await work();
  } catch (err) {
    model.error = err.message;
  }
  model.busy = null;
  render();
}

// ---------- actions ----------

async function load() {
  await run("Loading…", async () => {
    const config = await api("GET", "/api/config");
    if (config.baseUrl) model.baseUrl = config.baseUrl;
    model.username = config.username ?? "";
    model.hasPassword = config.hasPassword;
    model.intervalMinutes = Math.round(config.intervalMinutes ?? 30);
    if (config.baseDir) model.baseDir = config.baseDir;
    else if (config.courses?.[0]) model.baseDir = parentDir(config.courses[0].targetDir);
    model.selected = new Map((config.courses ?? []).map((c) => [c.refId, c]));
    model.password = "";
    model.saved = JSON.stringify(payload());
  });
  fillInputs();
  if (model.hasPassword && model.username) await loadCourses();
}

const testLogin = () => run("Signing in…", async () => {
  await api("POST", "/api/test-login", credentials());
  model.notice = "Login successful.";
});

const loadCourses = () => run("Loading courses from ILIAS…", async () => {
  model.available = await api("POST", "/api/courses", credentials());
});

const save = () => run(model.password ? "Checking login and saving…" : "Saving…", async () => {
  await api("PUT", "/api/config", payload());
  if (model.password) model.hasPassword = true;
  model.password = "";
  $("password").value = "";
  model.saved = JSON.stringify(payload());
  model.notice = "Saved. Syncing now.";
});

function revert() {
  load();
}

function setSelected(course, on) {
  if (on) {
    model.selected.set(course.refId, {
      refId: course.refId,
      title: course.title,
      targetDir: joinPath(model.baseDir, course.folderName),
      videos: false,
    });
  } else {
    model.selected.delete(course.refId);
  }
  render();
}

async function chooseFolder(refId) {
  const config = model.selected.get(refId);
  const path = await window.ilias.pickFolder(config.targetDir);
  if (path) { config.targetDir = path; render(); }
}

// ---------- rendering ----------

function fillInputs() {
  $("baseUrl").value = model.baseUrl;
  $("username").value = model.username;
  $("password").value = model.password;
  $("interval").value = String(model.intervalMinutes);
}

function renderChrome() {
  const status = $("status");
  status.className = "status";
  if (model.busy) {
    status.replaceChildren(h("div.ring"), h("span", {}, model.busy));
  } else if (model.error) {
    status.classList.add("error");
    status.replaceChildren(icon(0xEA39), h("span", { title: model.error }, model.error));
  } else if (model.notice) {
    status.classList.add("notice");
    status.replaceChildren(icon(0xE930), h("span", {}, model.notice));
  } else {
    status.replaceChildren();
  }

  const dirty = isDirty();
  $("save").disabled = !dirty || !!model.busy || !model.username;
  $("revert").hidden = !dirty || !model.saved;
  $("test-login").disabled = !!model.busy || !model.username || (!model.hasPassword && !model.password);
  $("reload").disabled = $("reload-empty").disabled = !!model.busy || !model.username;
}

function render() {
  renderChrome();

  let host = "ILIAS";
  try { host = new URL(model.baseUrl).host; } catch { /* still typing */ }
  $("profile-name").textContent = model.username || "Not signed in";
  $("profile-sub").textContent = host;
  const initial = model.username.trim()[0];
  $("avatar").replaceChildren(initial ? initial.toUpperCase() : icon(0xE77B));

  $("password").placeholder = model.hasPassword ? "••••••••" : "";
  $("password-desc").textContent = model.hasPassword
    ? "Saved in Credential Manager. Leave empty to keep it."
    : "Required to sign in";

  setPath($("baseDir"), model.baseDir);
  $("nav-count").textContent = model.selected.size ? String(model.selected.size) : "";
  renderCourses();
}

function courseCard(refId, title, available) {
  const config = model.selected.get(refId);
  const toggle = h("input.switch", {
    type: "checkbox",
    checked: !!config,
    "aria-label": title,
    onchange: (e) => {
      if (available) setSelected(available, e.target.checked);
      else if (!e.target.checked) { model.selected.delete(refId); render(); }
    },
  });
  const head = h("label.row.course-head", {},
    icon(available?.type === "grp" ? 0xE716 : 0xE8F1),
    h("div.row-text", {}, h("div.row-title.course-title", {}, title)),
    toggle,
  );
  head.querySelector(".ico").classList.add("lead");

  let detail = null;
  if (config) {
    const pathEl = h("span.path");
    setPath(pathEl, config.targetDir);
    detail = h("div.course-detail", {},
      icon(0xE8B7),
      pathEl,
      h("button.btn.small", { onclick: () => chooseFolder(refId) }, "Change…"),
      h("label.check", {},
        h("input", { type: "checkbox", checked: config.videos, onchange: (e) => { config.videos = e.target.checked; renderChrome(); } }),
        "Recordings (~500 MB each)"),
    );
  }
  return h(`div.card.course${config ? ".on" : ""}`, {}, head, detail);
}

function renderCourses() {
  const filter = model.filter.toLocaleLowerCase();
  const matches = (c) => !filter || c.title.toLocaleLowerCase().includes(filter) || model.selected.has(c.refId);

  // Groups arrive sorted newest semester first.
  const groups = new Map();
  for (const course of model.available) {
    if (!groups.has(course.groupLabel)) groups.set(course.groupLabel, []);
    groups.get(course.groupLabel).push(course);
  }
  const known = new Set(model.available.map((c) => c.refId));
  const orphaned = [...model.selected.values()].filter((c) => !known.has(c.refId)).sort((a, b) => a.title.localeCompare(b.title));

  const sections = [];
  for (const [name, courses] of groups) {
    const shown = courses.filter(matches);
    if (!shown.length) continue;
    const count = courses.filter((c) => model.selected.has(c.refId)).length;
    sections.push(
      h("h2.semester", {}, name, count ? h("span", {}, `${count} selected`) : null),
      h("div.group", {}, shown.map((c) => courseCard(c.refId, c.title, c))),
    );
  }
  if (orphaned.length) {
    sections.push(
      h("h2.semester", {}, "No longer on your dashboard"),
      h("div.group", {}, orphaned.map((c) => courseCard(c.refId, c.title, null))),
    );
  }

  const empty = !model.available.length && !orphaned.length;
  $("course-empty").hidden = !empty;
  $("course-list").replaceChildren(...sections);
  $("course-list").hidden = empty;
  $("selected-count").textContent = empty ? "" : `${model.selected.size} of ${model.available.length} courses selected`;
  if (!empty && !sections.length) $("course-list").append(h("p.hint", {}, icon(0xE721), `No courses match "${model.filter}".`));
}

function renderDaemon({ status, error }) {
  $("daemon-state").textContent = [headline(status, error), nextRunText(status)].filter(Boolean).join(" · ");
  $("restart").textContent = status ? "Restart" : "Start";
}

// ---------- navigation ----------

function navigate(page) {
  for (const item of document.querySelectorAll(".nav-item")) item.classList.toggle("active", item.dataset.page === page);
  for (const section of document.querySelectorAll(".page")) section.hidden = section.id !== `page-${page}`;
  $("scroll").scrollTop = 0;
}
for (const item of document.querySelectorAll(".nav-item")) item.onclick = () => navigate(item.dataset.page);
window.ilias.on("navigate", navigate);

// ---------- wiring ----------

for (const [id, key] of [["baseUrl", "baseUrl"], ["username", "username"], ["password", "password"]]) {
  $(id).addEventListener("input", (e) => { model[key] = key === "password" ? e.target.value : e.target.value.trim(); render(); });
}
$("interval").onchange = (e) => { model.intervalMinutes = Number(e.target.value); renderChrome(); };
$("filter").addEventListener("input", (e) => { model.filter = e.target.value; renderCourses(); });
$("choose-base").onclick = async () => {
  const path = await window.ilias.pickFolder(model.baseDir);
  if (path) { model.baseDir = path; render(); }
};
$("test-login").onclick = testLogin;
$("reload").onclick = $("reload-empty").onclick = loadCourses;
$("to-account").onclick = () => navigate("account");
$("save").onclick = save;
$("revert").onclick = revert;
$("show-log").onclick = () => window.ilias.action("show-log");
$("open-config").onclick = () => window.ilias.action("open-config");
$("restart").onclick = async () => {
  $("restart").disabled = true;
  await window.ilias.action("start-daemon");
  $("restart").disabled = false;
  if (!model.saved) load();
};
setPath($("log-path"), app.logPath);
setPath($("config-path"), app.configDir);

const loginSwitch = $("open-at-login");
const showLogin = (on) => { loginSwitch.checked = on; $("login-label").textContent = on ? "On" : "Off"; };
showLogin(app.openAtLogin);
loginSwitch.onchange = async () => showLogin(await window.ilias.setOpenAtLogin(loginSwitch.checked));

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "s" && !$("save").disabled) { e.preventDefault(); save(); }
  if (e.ctrlKey && e.key.toLowerCase() === "f") { navigate("courses"); $("filter").focus(); }
});

window.ilias.onStatus(renderDaemon);
renderDaemon(await window.ilias.status());

navigate(new URLSearchParams(location.search).get("page") ?? "account");
render();
await load();
