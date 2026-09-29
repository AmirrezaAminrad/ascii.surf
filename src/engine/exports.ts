/**
 * Pure frame-to-string export builders, shared by the clipboard and download
 * actions in App.tsx. Everything here takes the frame rows, the luminance
 * buffer (−1 = empty cell) and a structural theme — no DOM, no refs — so the
 * formatting and escaping are unit-testable.
 */

export interface ExportTheme {
  bg: string;
  fg: string;
  glow: string;
  mode: "mono" | "heat";
  /** Optional viewport color mode — exports match what the canvas showed. */
  colorMode?: ColorMode;
}

/** How luminance maps to color: theme gradient, spectral rainbow, or animated plasma. */
export type ColorMode = "ramp" | "rainbow" | "plasma";

export function hexToRgb(h: string): [number, number, number] {
  let s = h.replace("#", "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** h ∈ [0,360), s/l ∈ [0,1] → rgb triplet (0-255), all rounded. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Theme fg hue in degrees, or 200 (azure) when the fg is achromatic (Paper/Mono). */
export function fgHue(fgHex: string): number {
  const [r, g, b] = hexToRgb(fgHex).map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max - min < 1e-4) return 200;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (((h * 60) % 360) + 360) % 360;
}

// precomputed bg→fg→glow ramp so heat mode doesn't build an rgb() string per lit cell per frame
export const PAL_STEPS = 32;

/** Numeric ramp (shared by the ANSI/HTML exports and the canvas palette): index by round(lum * 31). */
export function buildRampRgb(
  bgHex: string,
  fgHex: string,
  glowHex: string,
): Array<[number, number, number]> {
  const bg = hexToRgb(bgHex),
    fg = hexToRgb(fgHex),
    glow = hexToRgb(glowHex);
  const lerp = (
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): [number, number, number] => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  return Array.from({ length: PAL_STEPS }, (_, i) => {
    const t = i / (PAL_STEPS - 1);
    return t < 0.5 ? lerp(bg, fg, t * 2 * 0.85 + 0.15) : lerp(fg, glow, (t - 0.5) * 2);
  });
}

/** Spectral "rainbow jet": violet → blue → green → yellow → red as luminance rises. */
export function buildRainbowRgb(): Array<[number, number, number]> {
  return Array.from({ length: PAL_STEPS }, (_, i) => {
    const t = i / (PAL_STEPS - 1);
    return hslToRgb(260 - 260 * t, 0.9, 0.22 + 0.5 * t);
  });
}

/** Plasma: the theme hue breathing through ±140° over time, brightness still set by luminance. */
export function buildPlasmaRgb(fgHex: string, phase: number): Array<[number, number, number]> {
  const h0 = fgHue(fgHex);
  return Array.from({ length: PAL_STEPS }, (_, i) => {
    const t = i / (PAL_STEPS - 1);
    const hue =
      (((h0 + 140 * Math.sin(t * 2.2 * Math.PI + phase * 0.9) + phase * 24) % 360) + 360) % 360;
    return hslToRgb(hue, 0.88, 0.18 + 0.58 * t);
  });
}

/** Palette for an export theme, honoring its colorMode (defaults: theme ramp). */
export function rampForExport(th: ExportTheme, phase = 0): Array<[number, number, number]> | null {
  if (th.mode === "mono" && !th.colorMode) return null;
  if (th.colorMode === "rainbow") return buildRainbowRgb();
  if (th.colorMode === "plasma") return buildPlasmaRgb(th.fg, phase);
  if (th.mode === "heat") return buildRampRgb(th.bg, th.fg, th.glow);
  return null;
}

/** Trim empty margins so copied/exported frames are tight around the shape. */
export function trimFrame(lines: string[]): string {
  let top = 0,
    bottom = lines.length - 1;
  while (top < lines.length && lines[top].trim() === "") top++;
  while (bottom > top && lines[bottom].trim() === "") bottom--;
  const slice = lines.slice(top, bottom + 1);
  let left = Infinity,
    right = 0;
  for (const l of slice) {
    const s = l.search(/\S/);
    if (s >= 0) {
      left = Math.min(left, s);
      right = Math.max(right, l.trimEnd().length);
    }
  }
  return slice.map((l) => l.slice(left, right).trimEnd()).join("\n");
}

/** ANSI truecolor frame: fg-colored glyphs for terminal pasting. */
export function frameAnsi(lines: string[], lum: Float32Array, th: ExportTheme): string {
  if (lines.length === 0 || lum.length === 0) return "";
  const ramp = rampForExport(th);
  const [fr, fgc, fb] = hexToRgb(th.fg);
  let out = "";
  let off = 0;
  for (const line of lines) {
    let row = "";
    let lastKey = "";
    for (let c = 0; c < line.length; c++) {
      const chr = line[c];
      const l = off + c < lum.length ? lum[off + c] : -1;
      if (chr === " " || l < 0) {
        if (lastKey !== "") {
          row += "\x1b[0m";
          lastKey = "";
        }
        row += chr;
        continue;
      }
      const rgb = ramp ? ramp[Math.max(0, Math.min(31, Math.round(l * 31)))] : [fr, fgc, fb];
      const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      if (key !== lastKey) {
        row += `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
        lastKey = key;
      }
      row += chr;
    }
    if (lastKey !== "") row += "\x1b[0m";
    out += row + "\n";
    off += line.length;
  }
  return out.replace(/\n$/, "");
}

/** HTML export: self-contained colorized <pre> (web/email embedding). */
export function frameHtml(lines: string[], lum: Float32Array, th: ExportTheme): string {
  if (lines.length === 0 || lum.length === 0) return "";
  const ramp = rampForExport(th);
  const [fr, fgc, fb] = hexToRgb(th.fg);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let out = "";
  let off = 0;
  for (const line of lines) {
    let row = "";
    let lastKey = "";
    for (let c = 0; c < line.length; c++) {
      const chr = line[c];
      const l = off + c < lum.length ? lum[off + c] : -1;
      if (chr === " " || l < 0) {
        if (lastKey !== "") row += "</span>";
        row += esc(chr);
        lastKey = "";
        continue;
      }
      const rgb = ramp ? ramp[Math.max(0, Math.min(31, Math.round(l * 31)))] : [fr, fgc, fb];
      const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      if (key !== lastKey) {
        row +=
          (lastKey === "" ? "" : "</span>") +
          `<span style="color:rgb(${rgb[0]},${rgb[1]},${rgb[2]})">`;
        lastKey = key;
      }
      row += esc(chr);
    }
    if (lastKey !== "") row += "</span>";
    out += row + "\n";
    off += line.length;
  }
  return (
    `<pre style="margin:0;background:${th.bg};color:${th.fg};font:12px/1.15 ui-monospace,Consolas,monospace;letter-spacing:0.08em;padding:12px">` +
    out.replace(/\n$/, "") +
    "</pre>"
  );
}

/** SVG export: trimmed vector frame with per-run colored tspans. */
export function frameSvg(lines: string[], lum: Float32Array, th: ExportTheme): string {
  if (lines.length === 0 || lum.length === 0) return "";
  const ramp = rampForExport(th);
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // trim empty margins (same rule as the TXT export) for a tight viewBox
  let top = 0,
    bottom = lines.length - 1;
  while (top < lines.length && lines[top].trim() === "") top++;
  while (bottom > top && lines[bottom].trim() === "") bottom--;
  let left = Infinity,
    right = 0;
  for (let r = top; r <= bottom; r++) {
    const s = lines[r].search(/\S/);
    if (s >= 0) {
      left = Math.min(left, s);
      right = Math.max(right, lines[r].trimEnd().length);
    }
  }
  if (left === Infinity) return "";
  const fs = 12,
    ls = 1.2,
    lh = fs * 1.15;
  const adv = fs * 0.6 + ls; // monospace advance + letter-spacing ≈ canvas metrics
  const rowsOut: string[] = [];
  for (let r = top; r <= bottom; r++) {
    const line = lines[r];
    const rowLum = r * line.length;
    let text = "";
    let open = false;
    let lastKey = "";
    for (let c = left; c < right; c++) {
      const chr = c < line.length ? line[c] : " ";
      const l = rowLum + c < lum.length ? lum[rowLum + c] : -1;
      if (chr === " " || l < 0) {
        if (open) {
          text += "</tspan>";
          open = false;
        }
        lastKey = "";
        continue;
      }
      const rgb = ramp ? ramp[Math.max(0, Math.min(31, Math.round(l * 31)))] : null;
      const key = rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : "fg";
      if (key !== lastKey) {
        if (open) text += "</tspan>";
        // explicit x: gaps (spaces) must not collapse into the next run
        text += `<tspan x="${((c - left) * adv).toFixed(1)}"${rgb ? ` fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"` : ""}>`;
        open = true;
        lastKey = key;
      }
      text += esc(chr);
    }
    if (open) text += "</tspan>";
    if (text)
      rowsOut.push(
        `<text x="0" y="${((r - top) * lh + fs).toFixed(1)}"${ramp ? "" : ` fill="${th.fg}"`}>${text}</text>`,
      );
  }
  if (rowsOut.length === 0) return "";
  const w = ((right - left) * adv).toFixed(1);
  const h = ((bottom - top + 1) * lh).toFixed(1);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${th.bg}"/>` +
    `<g font-family="ui-monospace, 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, monospace" font-size="${fs}" letter-spacing="${ls}">` +
    rowsOut.join("") +
    `</g></svg>`
  );
}
