import { BrowserWindow, nativeImage, nativeTheme } from "electron";

// Icons are drawn as SVG and rasterised once at start-up (and again when the
// taskbar theme changes), so no binary assets are needed and they stay crisp
// at every display scale.

const CAP = `
  <path d="M12 4.5 2.5 9.25 12 14l9.5-4.75z"/>
  <path d="M6.5 11.75v3.75c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-3.75"/>
  <path d="M21.5 9.25v5"/>`;

const BADGES = {
  syncing: { fill: "#0f6cbd", glyph: `<path d="M15.6 18a2.4 2.4 0 0 1 4.3-1.4M20.4 18a2.4 2.4 0 0 1-4.3 1.4" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>` },
  paused: { fill: "#8a8a8a", glyph: `<path d="M16.8 16v4M19.2 16v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` },
  error: { fill: "#d83b01", glyph: `<path d="M18 15.6v2.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="20.3" r=".95" fill="#fff"/>` },
};

function traySvg(state, color) {
  const badge = BADGES[state];
  const cap = `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      ${state === "offline" ? 'opacity=".45"' : ""} ${badge ? 'mask="url(#hole)"' : ""}>${CAP}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <defs><mask id="hole"><rect width="24" height="24" fill="#fff"/><circle cx="18" cy="18" r="7.2" fill="#000"/></mask></defs>
    ${cap}
    ${badge ? `<circle cx="18" cy="18" r="5.6" fill="${badge.fill}"/>${badge.glyph}` : ""}
  </svg>`;
}

const APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#2a4fd6"/>
  </linearGradient></defs>
  <rect x="1" y="1" width="22" height="22" rx="5.5" fill="url(#g)"/>
  <g transform="translate(2.4 2.6) scale(.8)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${CAP}</g>
</svg>`;

/** Runs in a hidden renderer: draws each SVG onto a canvas and returns PNG data URLs. */
function rasterise(jobs) {
  return Promise.all(jobs.map(async ({ svg, size }) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").drawImage(img, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  }));
}

async function renderSet(sets) {
  const jobs = sets.flatMap(({ svg, sizes }) => sizes.map((size) => ({ svg, size })));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL("about:blank");
    const urls = await win.webContents.executeJavaScript(`(${rasterise})(${JSON.stringify(jobs)})`);
    let i = 0;
    return sets.map(({ sizes, base }) => {
      const image = nativeImage.createEmpty();
      for (const size of sizes) image.addRepresentation({ scaleFactor: size / base, dataURL: urls[i++] });
      return image;
    });
  } finally {
    win.destroy();
  }
}

export const TRAY_STATES = ["offline", "idle", "syncing", "paused", "error"];

/** Returns { tray: { [state]: NativeImage }, app: NativeImage }. */
export async function renderIcons() {
  // The taskbar can be dark while apps are light (Windows' default), so ask about the taskbar.
  const color = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? "#ffffff" : "#1b1b1b";
  const traySizes = [16, 20, 24, 32];
  const images = await renderSet([
    ...TRAY_STATES.map((state) => ({ svg: traySvg(state, color), sizes: traySizes, base: 16 })),
    { svg: APP_SVG, sizes: [32, 48, 64, 256], base: 32 },
  ]);
  return {
    tray: Object.fromEntries(TRAY_STATES.map((state, i) => [state, images[i]])),
    app: images.at(-1),
  };
}
