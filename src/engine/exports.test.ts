import { describe, expect, it } from "vitest";
import {
  buildPlasmaRgb,
  buildRainbowRgb,
  buildRampRgb,
  frameAnsi,
  frameHtml,
  frameSvg,
  fgHue,
  hslToRgb,
  hexToRgb,
  rampForExport,
  trimFrame,
  type ExportTheme,
} from "./exports";

const MONO: ExportTheme = { bg: "#000000", fg: "#ffffff", glow: "#808080", mode: "mono" };
const HEAT: ExportTheme = { bg: "#0a0a12", fg: "#ff9955", glow: "#ffee88", mode: "heat" };

/** 2-row rectangular fixture honoring the renderer invariant (lit ⟺ non-space):
 *  row 0 = " a<&b" lums (0.5, 0.3, 0.8, 1.0) · row 1 = "  &> " lums (0.25, 0.4). */
function fixture(theme: ExportTheme) {
  const lines = [" a<&b", "  &> "];
  const lum = new Float32Array([-1, 0.5, 0.3, 0.8, 1.0, -1, -1, 0.25, 0.4, -1]);
  return { lines, lum, theme };
}

describe("hex/ramp helpers", () => {
  it("parses 3- and 6-digit hex colors", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#0f0")).toEqual([0, 255, 0]);
    expect(hexToRgb("123456")).toEqual([0x12, 0x34, 0x56]);
  });

  it("builds a 32-step ramp from bg → fg → glow", () => {
    const ramp = buildRampRgb("#000000", "#808080", "#ffffff");
    expect(ramp).toHaveLength(32);
    expect(ramp[0][0]).toBeLessThan(40); // near bg
    expect(ramp[31][0]).toBeGreaterThan(215); // near glow
    // monotonic brightness across the ramp
    for (let i = 1; i < 32; i++) {
      expect(ramp[i][0] + ramp[i][1] + ramp[i][2]).toBeGreaterThanOrEqual(
        ramp[i - 1][0] + ramp[i - 1][1] + ramp[i - 1][2],
      );
    }
  });

  it("maps hsl → rgb on primaries and derives the theme fg hue", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
    expect(fgHue("#ff0000")).toBeCloseTo(0, 0);
    expect(fgHue("#39ff6a")).toBeGreaterThan(100); // phosphor green
    expect(fgHue("#e5e5e5")).toBe(200); // achromatic fallback
  });

  it("rainbow and plasma palettes: 32 steps, dark ends dim, plasma moves with phase", () => {
    const rb = buildRainbowRgb();
    expect(rb).toHaveLength(32);
    const bright = (c: [number, number, number]) => c[0] + c[1] + c[2];
    expect(bright(rb[0])).toBeLessThan(bright(rb[31])); // luminance still drives brightness
    const p0 = buildPlasmaRgb("#39ff6a", 0);
    const p1 = buildPlasmaRgb("#39ff6a", 2.5);
    expect(p0).toHaveLength(32);
    expect(bright(p0[31])).toBeGreaterThan(bright(p0[0]));
    // the palette actually animates: some step differs between phases
    expect(p0.some((c, i) => c[0] !== p1[i][0] || c[1] !== p1[i][1] || c[2] !== p1[i][2])).toBe(
      true,
    );
  });

  it("rampForExport honors colorMode and defaults by theme mode", () => {
    expect(rampForExport(MONO)).toBeNull(); // mono + no colorMode → flat fg
    expect(rampForExport({ ...MONO, colorMode: "rainbow" })).toHaveLength(32); // color mode overrides mono
    expect(rampForExport(HEAT)).toHaveLength(32);
    expect(rampForExport(HEAT)).toEqual(buildRampRgb(HEAT.bg, HEAT.fg, HEAT.glow));
  });
});

describe("trimFrame", () => {
  it("strips empty margins, common left padding and trailing spaces", () => {
    expect(trimFrame(["   ", "  x  ", " xy ", "   "])).toBe(" x\nxy");
    expect(trimFrame(["     "])).toBe("");
    expect(trimFrame([])).toBe("");
  });
});

describe("frameAnsi", () => {
  it("emits SGR truecolor runs and resets between gaps", () => {
    const s = frameAnsi(fixture(MONO).lines, fixture(MONO).lum, MONO);
    expect(s).toContain("\x1b[38;2;255;255;255m");
    expect(s).toMatch(/\x1b\[0m/); // resets around the empty cells
    expect(s).not.toMatch(/\n$/); // no trailing newline
    expect(s.split("\n")).toHaveLength(2);
  });

  it("colors cells through the heat ramp (mono uses flat fg)", () => {
    const heat = frameAnsi(fixture(HEAT).lines, fixture(HEAT).lum, HEAT);
    const mono = frameAnsi(fixture(MONO).lines, fixture(MONO).lum, MONO);
    expect(heat).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    // heat: three lums → several distinct colors
    const colors = [...heat.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1]);
    expect(new Set(colors).size).toBeGreaterThan(1);
    // mono: every SGR is the flat fg color
    const monoColors = [...mono.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1]);
    expect(new Set(monoColors)).toEqual(new Set(["255;255;255"]));
  });

  it("returns empty for empty frames, whitespace for blank ones", () => {
    expect(frameAnsi([], new Float32Array(), MONO)).toBe("");
    expect(frameAnsi(["   "], new Float32Array([0, 0, 0]), MONO)).toBe("   ");
  });
});

describe("frameHtml", () => {
  it("escapes & and < in glyphs", () => {
    const s = frameHtml(fixture(MONO).lines, fixture(MONO).lum, MONO);
    expect(s).toContain("&lt;");
    expect(s).toContain("&amp;");
    expect(s).not.toContain("<b"); // the `<` glyph must be escaped, never raw
    expect(s).not.toContain("<&");
  });

  it("wraps in a <pre> carrying the theme background", () => {
    const s = frameHtml(fixture(MONO).lines, fixture(MONO).lum, MONO);
    expect(s.startsWith(`<pre style="margin:0;background:${MONO.bg}`)).toBe(true);
    expect(s.endsWith("</pre>")).toBe(true);
    expect(s).toMatch(/<span style="color:rgb\(\d+,\d+,\d+\)">/);
  });
});

describe("frameSvg", () => {
  it("escapes the XML specials in glyphs", () => {
    const s = frameSvg(fixture(MONO).lines, fixture(MONO).lum, MONO);
    expect(s).toContain("&amp;");
    expect(s).toContain("&lt;");
    expect(s).toContain("&gt;");
    expect(s).not.toContain("<&"); // the raw glyph pair never leaks into markup
    expect(s).toContain(">a&lt;&amp;b</tspan>"); // row-0 run survives, escaped
  });

  it("trims the viewBox and offsets runs with explicit x", () => {
    const s = frameSvg(fixture(MONO).lines, fixture(MONO).lum, MONO);
    // content spans cols 1..5 → trimmed width = 4 cells; 2 rows
    const w = (4 * (12 * 0.6 + 1.2)).toFixed(1);
    expect(s).toContain(`width="${w}"`);
    expect(s).toContain(`viewBox="0 0 ${w} `); // height follows in the same attribute
    expect(s).toContain(`<rect width="100%" height="100%" fill="${MONO.bg}"/>`);
    expect(s).toMatch(/<tspan x="8\.4"/); // row 1 '&' = col 2, trimmed → 1 * 8.4
  });

  it("returns empty for blank or whitespace-only frames", () => {
    expect(frameSvg(["   "], new Float32Array(3).fill(-1), MONO)).toBe("");
    expect(frameSvg([], new Float32Array(), MONO)).toBe("");
  });
});
