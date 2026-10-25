// Applies the Windows accent colour and backdrop support passed in by the main process.
const params = new URLSearchParams(location.search);
const accent = params.get("accent");
if (accent && /^[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty("--accent-base", `#${accent}`);
if (params.get("material") !== "1") document.documentElement.classList.add("no-material");

/** Tiny DOM builder: h("div.card", { onclick }, child, "text"). */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export const icon = (codepoint) => h("i.ico", { "aria-hidden": "true" }, String.fromCodePoint(codepoint));

export const APP_GLYPH = `<svg class="app-glyph" viewBox="0 0 24 24" aria-hidden="true">
  <defs><linearGradient id="ag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#2a4fd6"/></linearGradient></defs>
  <rect x="1" y="1" width="22" height="22" rx="5.5" fill="url(#ag)"/>
  <g transform="translate(2.4 2.6) scale(.8)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4.5 2.5 9.25 12 14l9.5-4.75z"/><path d="M6.5 11.75v3.75c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-3.75"/><path d="M21.5 9.25v5"/>
  </g></svg>`;
