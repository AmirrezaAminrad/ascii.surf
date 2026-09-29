/**
 * ascii.surf documentation capture harness.
 *
 * Served by the Vite dev server (http://localhost:31337/tools/capture/) so it
 * can import the real engine and the real BootRain component. Driven from
 * browser automation; PNG/GIF output is POSTed to the collector
 * (tools/capture/collect.mjs, :31339) which writes into docs/media/.
 *
 * window.__capture:
 *   shot(opts)        one themed still frame -> <out>.png
 *   record(opts)      a shape rotating/animating    -> <out>.gif + <out>.review.png
 *   boot(opts)        mount the real BootRain and record it -> boot.gif
 *   themesGrid(opts)  torus in all 12 themes       -> themes-grid.png
 *   shapes()          registry ids (sanity check)
 *
 * The draw path mirrors src/components/AsciiView.tsx (ramp palette, run-length
 * batching, mono flat rows) so captures look exactly like the app.
 */
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { renderFrame, compileSurface } from "../../src/engine/renderer";
import { findEntry, entryId } from "../../src/engine/registry";
import { defaultParams } from "../../src/engine/types";
import { CHARSETS } from "../../src/engine/presets";
import {
  buildRampRgb,
  buildRainbowRgb,
  buildPlasmaRgb,
  hexToRgb,
  PAL_STEPS,
} from "../../src/engine/exports";
import { THEMES } from "../../src/themes";
import { clampZoom, HOME_ANGLES } from "../../src/view";

const COLLECTOR = "http://localhost:31339";
const statusEl = document.getElementById("status");

function status(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log(`[capture] ${msg}`);
}

async function save(name, blob) {
  const res = await fetch(`${COLLECTOR}/save?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: blob,
  });
  if (!res.ok) throw new Error(`collector refused ${name}: ${res.status}`);
  const info = await res.json();
  status(`saved ${name} (${(info.bytes / 1024).toFixed(0)} kB)`);
  return info;
}

const FONT_STACK = 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace';

// --- settings ----------------------------------------------------------------

function baseSettings(over = {}) {
  return {
    fontSize: 11,
    charset: CHARSETS[0].chars,
    light: [0.4, 0.6, -1],
    zoom: 1,
    speed: 1,
    autoRotate: true,
    samples: 160,
    samplesV: 0,
    theme: THEMES[0],
    spin: [0.6, 1.0, 0.25],
    paused: false,
    timeScale: 1,
    projection: "perspective",
    fov: 2.4,
    camDist: 5,
    ambient: 0.12,
    diffuse: 0.88,
    specular: 0,
    shininess: 24,
    pointSize: 1,
    jitter: 0,
    persistence: 0,
    fog: 0,
    demoDwell: 8,
    gridOverlay: false,
    colorMode: "ramp",
    ...over,
  };
}

function resolveTheme(name) {
  const t = THEMES.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!t) throw new Error(`no theme "${name}"`);
  return t;
}

function resolveCharset(token) {
  const c = CHARSETS.find((x) => x.name.toLowerCase() === String(token).toLowerCase());
  return c ? c.chars : token;
}

function makeRenderable(shapeId, paramOverrides = {}) {
  const entry = findEntry(shapeId);
  if (!entry) throw new Error(`no shape "${shapeId}"`);
  if (entry.tag === "native") {
    const params = defaultParams(entry.shape.params);
    return { tag: "native", shape: entry.shape, params: { ...params, ...paramOverrides } };
  }
  let fn = null;
  try {
    fn = compileSurface(entry.def);
  } catch {
    // compile error: keep fn null so the frame renders as an error surface
  }
  return { tag: "code", def: entry.def, fn };
}

// --- drawing (mirrors AsciiView's paint path) --------------------------------

function makeStage(width, height, fontSize) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const font = `${fontSize}px ${FONT_STACK}`;
  ctx.font = font;
  const cw = ctx.measureText("M").width;
  const ch = fontSize * 1.15;
  const cols = Math.max(8, Math.floor(width / cw));
  const rows = Math.max(4, Math.floor(height / ch));
  return {
    canvas,
    ctx,
    font,
    cw,
    ch,
    cols,
    rows,
    width,
    height,
    ox: (width - cols * cw) / 2,
    oy: (height - rows * ch) / 2,
  };
}

function hasInk(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== " ") return true;
  return false;
}

function drawPalette(theme, colorMode, phase) {
  const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
  if (colorMode === "plasma") return buildPlasmaRgb(theme.fg, phase).map(rgb);
  if (colorMode === "rainbow") return buildRainbowRgb().map(rgb);
  return buildRampRgb(theme.bg, theme.fg, theme.glow).map(rgb);
}

function drawFrame(stage, res, theme, colorMode, phase) {
  const { ctx, cols, rows, ox, oy, width: W, height: H, ch, cw } = stage;
  ctx.textBaseline = "top";
  if (theme.mode === "mono" && colorMode === "ramp") {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = theme.fg;
    for (let row = 0; row < rows; row++) {
      const line = res.chars[row];
      if (!line || !hasInk(line)) continue;
      ctx.fillText(line, ox, oy + row * ch);
    }
    return;
  }
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  const palette = drawPalette(theme, colorMode, phase);
  const maxIdx = PAL_STEPS - 1;
  for (let row = 0; row < rows; row++) {
    const line = res.chars[row];
    if (!line) continue;
    const base = row * cols;
    let c = 0;
    while (c < cols) {
      if (line[c] === " ") {
        c++;
        continue;
      }
      const li = res.lum[base + c];
      const idx = Math.max(0, Math.min(maxIdx, Math.round(li * maxIdx)));
      let end = c + 1;
      while (end < cols && line[end] !== " ") {
        const lj = res.lum[base + end];
        const jdx = Math.max(0, Math.min(maxIdx, Math.round(lj * maxIdx)));
        if (jdx !== idx) break;
        end++;
      }
      ctx.fillStyle = palette[idx];
      ctx.fillText(c + 1 === end ? line[c] : line.slice(c, end), ox + c * cw, oy + row * ch);
      c = end;
    }
  }
}

function renderOpts(stage, s, angles, time, dt) {
  return {
    cols: stage.cols,
    rows: stage.rows,
    angleX: angles[0],
    angleY: angles[1],
    angleZ: angles[2],
    zoom: clampZoom(s.zoom),
    light: s.light,
    charset: s.charset,
    samplesU: s.samples,
    samplesV: s.samplesV > 0 ? s.samplesV : s.samples,
    aspect: stage.ch / stage.cw,
    time,
    dt,
    projection: s.projection,
    fov: s.fov,
    camDist: s.camDist,
    ambient: s.ambient,
    diffuse: s.diffuse,
    specular: s.specular,
    shininess: s.shininess,
    pointSize: s.pointSize,
    jitter: s.jitter,
    persistence: s.persistence,
    fog: s.fog,
    mouse: { x: 0.5, y: 0.5, down: false },
  };
}

function gifPalette(theme, colorMode, phase) {
  if (colorMode === "plasma") return [hexToRgb(theme.bg), ...buildPlasmaRgb(theme.fg, phase)];
  if (colorMode === "rainbow") return [hexToRgb(theme.bg), ...buildRainbowRgb()];
  if (theme.mode === "mono") return [hexToRgb(theme.bg), hexToRgb(theme.fg)];
  return [hexToRgb(theme.bg), ...buildRampRgb(theme.bg, theme.fg, theme.glow)];
}

// --- public API ---------------------------------------------------------------

/** One still frame: { shape, theme, colorMode?, charset?, angles?, zoom?, width?, height?, fontSize?, time?, out, set?, params? } */
async function shot(opts) {
  const {
    shape,
    theme: themeName,
    colorMode = "ramp",
    charset = "Classic",
    angles = [...HOME_ANGLES],
    zoom = 1,
    width = 640,
    height = 480,
    fontSize = 11,
    time = 1.0,
    out,
    set = {},
    params = {},
  } = opts;
  const theme = resolveTheme(themeName);
  const s = baseSettings({
    theme,
    charset: resolveCharset(charset),
    colorMode,
    zoom,
    fontSize: set.fontSize ?? fontSize,
    ...set,
  });
  const stage = makeStage(width, height, s.fontSize);
  const r = makeRenderable(shape, params);
  const res = renderFrame(r, renderOpts(stage, s, angles, time, 0));
  drawFrame(stage, res, theme, colorMode, time);
  const blob = await new Promise((resolve2) => stage.canvas.toBlob(resolve2, "image/png"));
  return save(out, blob);
}

/**
 * Animated capture: { shape, theme, colorMode?, charset?, angles?, spin?,
 * duration?, fps?, warmup?, width?, height?, zoom?, out, set?, params? }.
 * Frames advance dt=1/fps each step (stateful sims animate; angles integrate
 * spin) — not wall-clock, so the GIF is exactly duration*fps frames.
 */
async function record(opts) {
  const {
    shape,
    theme: themeName,
    colorMode = "ramp",
    charset = "Classic",
    angles = [...HOME_ANGLES],
    spin = [0, 0.785, 0],
    duration = 8,
    fps = 15,
    warmup = 0,
    width = 560,
    height = 420,
    zoom = 1,
    out,
    set = {},
    params = {},
  } = opts;
  const theme = resolveTheme(themeName);
  const s = baseSettings({
    theme,
    charset: resolveCharset(charset),
    colorMode,
    zoom,
    ...set,
  });
  const stage = makeStage(width, height, s.fontSize);
  const r = makeRenderable(shape, params);
  const a = [...angles];

  for (let i = 0; i < Math.round(warmup * fps); i++) {
    renderFrame(r, renderOpts(stage, s, a, i / fps, 1 / fps));
  }

  const total = Math.round(duration * fps);
  const delay = Math.round(1000 / fps);
  const reviewIdx = Math.floor(total * 0.45);
  const enc = GIFEncoder();
  let reviewPromise = null;
  let fixedPalette = null;

  for (let i = 0; i < total; i++) {
    const t = warmup + i / fps;
    a[0] += spin[0] / fps;
    a[1] += spin[1] / fps;
    a[2] += spin[2] / fps;
    const res = renderFrame(r, renderOpts(stage, s, a, t, 1 / fps));
    const phase = colorMode === "plasma" ? t : 0;
    drawFrame(stage, res, theme, colorMode, phase);
    if (i === 0 || colorMode === "plasma") {
      if (i === 0 && colorMode !== "plasma") fixedPalette = gifPalette(theme, colorMode, 0);
      const pal = colorMode === "plasma" ? gifPalette(theme, colorMode, t) : fixedPalette;
      const { data } = stage.ctx.getImageData(0, 0, width, height);
      enc.writeFrame(applyPalette(data, pal), width, height, {
        palette: pal,
        delay,
        first: i === 0,
      });
    } else {
      const { data } = stage.ctx.getImageData(0, 0, width, height);
      enc.writeFrame(applyPalette(data, fixedPalette), width, height, { delay });
    }
    if (i === reviewIdx) {
      reviewPromise = new Promise((resolve2) => stage.canvas.toBlob(resolve2, "image/png"));
    }
  }
  enc.finish();
  if (reviewPromise) await save(`${out}.review.png`, await reviewPromise);
  const blob = new Blob([enc.bytes()], { type: "image/gif" });
  return save(`${out}.gif`, blob);
}

/** Record the real BootRain component: { width?, height?, fps?, duration?, out? } */
async function boot(opts = {}) {
  const { width = 800, height = 500, fps = 15, duration = 1.3, out = "boot.gif" } = opts;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BootRain } = await import("../../src/components/BootRain.tsx");
  const host = document.getElementById("boot-host");
  const root = createRoot(host);
  root.render(React.createElement(BootRain));
  await new Promise((r) => setTimeout(r, 80));
  const src = host.querySelector("canvas");
  if (!src) throw new Error("BootRain canvas not found");

  const cap = document.createElement("canvas");
  cap.width = width;
  cap.height = height;
  const ctx = cap.getContext("2d", { willReadFrequently: true });

  // seed the global palette from one live frame (rain colors are constant)
  ctx.drawImage(src, 0, 0, width, height);
  const seed = ctx.getImageData(0, 0, width, height);
  const palette = quantize(seed.data, 32);

  const total = Math.max(4, Math.round(duration * fps));
  const enc = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (let i = 0; i < total; i++) {
    ctx.drawImage(src, 0, 0, width, height);
    // composite the caption (the real one is DOM text over the canvas)
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `10px ${FONT_STACK}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3.5px";
    const label = "ascii.surf · booting";
    const tw = ctx.measureText(label).width;
    const cx = width / 2 - 4;
    const cy = height - 24;
    ctx.fillStyle = "rgba(0,255,65,0.7)";
    ctx.fillText(label, cx, cy);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = "#00ff41";
    ctx.fillRect(cx + tw / 2 + 4, cy - 9, 6, 10);
    ctx.textAlign = "start";
    const { data } = ctx.getImageData(0, 0, width, height);
    enc.writeFrame(applyPalette(data, palette), width, height, {
      palette,
      delay,
      first: i === 0,
    });
    await new Promise((r) => setTimeout(r, delay));
  }
  enc.finish();
  root.unmount();
  const blob = new Blob([enc.bytes()], { type: "image/gif" });
  return save(out, blob);
}

/** Torus in all 12 themes as a 4x3 contact sheet: { shape?, angles?, out? } */
async function themesGrid(opts = {}) {
  const {
    shape = "torus",
    angles = [0.9, 0.4, 0],
    zoom = 1.08,
    out = "themes-grid.png",
    cellW = 480,
    cellH = 300,
    fontSize = 10,
  } = opts;
  const per = [];
  for (const theme of THEMES) {
    const stage = makeStage(cellW, cellH, fontSize);
    const s = baseSettings({ theme, zoom });
    const r = makeRenderable(shape);
    const res = renderFrame(r, renderOpts(stage, s, angles, 1.2, 0));
    drawFrame(stage, res, theme, "ramp", 0);
    per.push({ stage, theme });
  }
  const pad = 2;
  const W = cellW * 4 + pad * 5;
  const H = cellH * 3 + pad * 5;
  const comp = document.createElement("canvas");
  comp.width = W;
  comp.height = H;
  const ctx = comp.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  per.forEach(({ stage, theme }, i) => {
    const x = pad + (i % 4) * (cellW + pad);
    const y = pad + Math.floor(i / 4) * (cellH + pad);
    ctx.drawImage(stage.canvas, x, y);
    ctx.font = `11px ${FONT_STACK}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.fg;
    ctx.globalAlpha = 0.85;
    ctx.fillText(theme.name.toUpperCase(), x + 10, y + cellH - 10);
    ctx.globalAlpha = 1;
  });
  const blob = await new Promise((resolve2) => comp.toBlob(resolve2, "image/png"));
  return save(out, blob);
}

/** Batch runner for automation: window.__capture.run(jobs) processes
 * sequentially in the page (evaluate() has a 3s cap) and reports progress via
 * window.__capture.state(). jobs: [{ kind: "record"|"shot"|"boot"|"grid", ...opts }] */
const runner = {
  busy: false,
  done: [],
  failed: [],
  current: null,
  async run(jobs) {
    if (runner.busy) throw new Error("runner already busy");
    runner.busy = true;
    runner.done = [];
    runner.failed = [];
    try {
      for (const job of jobs) {
        const { kind, ...opts } = job;
        runner.current = `${kind}:${opts.out ?? opts.shape ?? ""}`;
        status(`run ${runner.done.length + 1}/${jobs.length} ${runner.current}`);
        try {
          if (kind === "record") await record(opts);
          else if (kind === "shot") await shot(opts);
          else if (kind === "boot") await boot(opts);
          else if (kind === "grid") await themesGrid(opts);
          else throw new Error(`unknown kind ${kind}`);
          runner.done.push(runner.current);
        } catch (err) {
          runner.failed.push(`${runner.current}: ${err?.message ?? err}`);
          console.error(err);
        }
      }
    } finally {
      runner.busy = false;
      runner.current = null;
      status(`run finished: ${runner.done.length} ok, ${runner.failed.length} failed`);
    }
  },
  state() {
    return { ...runner };
  },
};

function shapes() {
  const ids = [
    "torus",
    "trefoil",
    "klein",
    "dini",
    "tesseract",
    "menger",
    "lorenz",
    "heart",
    "gyroid",
    "mobius",
    "sierpinski",
    "supershape",
    "torusknot",
    "shader-tunnel",
  ];
  return (
    THEMES.map((t) => t.name).join(",") +
    " | " +
    ids.map((id) => (findEntry(id) ? entryId(findEntry(id)) : `MISSING:${id}`)).join(",")
  );
}

window.__capture = {
  shot,
  record,
  boot,
  themesGrid,
  shapes,
  run: runner.run,
  state: runner.state,
  status,
};
status("harness ready");
