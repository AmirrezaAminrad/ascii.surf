import { describe, expect, it } from "vitest";
import { charsFromLum, compileSurface, renderFrame } from "./renderer";
import { PRESETS } from "./presets";
import { findEntry } from "./registry";

const A = ".,-~:;=!*#$@"; // Classic ramp
const B = "01"; // Binary ramp

function grid(cols: number, rows: number, fill: (i: number) => number): Float32Array {
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) lum[i] = fill(i);
  return lum;
}

describe("charsFromLum", () => {
  it("sizes output to rows × cols", () => {
    const lines = charsFromLum(
      grid(12, 5, () => 0.5),
      12,
      5,
      A,
    );
    expect(lines).toHaveLength(5);
    for (const l of lines) expect(l).toHaveLength(12);
  });

  it("maps negative luminance to spaces and zero-lit cells to the first ramp char", () => {
    const lum = new Float32Array([-1, 0, 0.5, 1]);
    const lines = charsFromLum(lum, 4, 1, A);
    expect(lines[0][0]).toBe(" ");
    expect(lines[0][1]).toBe(A[0]);
    expect(lines[0][2]).toBe(A[Math.floor(0.5 * (A.length - 1) + 0.5)]);
    expect(lines[0][3]).toBe(A[A.length - 1]);
  });

  it("is monotonic in luminance", () => {
    const lum = grid(A.length, 1, (i) => i / (A.length - 1));
    const line = charsFromLum(lum, A.length, 1, A)[0];
    expect(line).toBe(A);
  });

  it("falls back to spaces on an empty charset", () => {
    const lines = charsFromLum(
      grid(6, 2, () => 0.9),
      6,
      2,
      "",
    );
    for (const l of lines) expect(l).toBe(" ".repeat(6));
  });

  it("dither endpoints are pure: mix 0 and mix 1 both render the new ramp, B only appears mid-fade", () => {
    const lum = grid(40, 10, () => 0.5);
    const mid = A[Math.floor(0.5 * (A.length - 1) + 0.5)];
    expect(charsFromLum(lum, 40, 10, A, B, 0).join("")).toBe(mid.repeat(400));
    expect(charsFromLum(lum, 40, 10, A, B, 1).join("")).toBe(mid.repeat(400));
    const mixed = charsFromLum(lum, 40, 10, A, B, 0.5).join("");
    expect(mixed).toContain(mid); // cells still on the new ramp
    expect(mixed).toContain(B[Math.floor(0.5 * (B.length - 1) + 0.5)]); // cells still on the old ramp
  });

  it("dither is deterministic for a given cell and mix", () => {
    const lum = grid(64, 16, () => 0.5);
    expect(charsFromLum(lum, 64, 16, A, B, 0.37)).toEqual(charsFromLum(lum, 64, 16, A, B, 0.37));
  });
});

describe("renderFrame", () => {
  it("renders a code preset to a full char grid with lit cells", () => {
    const def = PRESETS[0];
    const fn = compileSurface(def);
    const res = renderFrame(
      { tag: "code", def, fn },
      {
        cols: 40,
        rows: 20,
        angleX: 0.5,
        angleY: 0.7,
        angleZ: 0,
        zoom: 1,
        light: [0.4, 0.6, -1],
        charset: A,
        samplesU: 48,
        samplesV: 24,
        aspect: 1.9,
        time: 0,
      },
    );
    expect(res.chars).toHaveLength(20);
    expect(res.chars.every((l) => l.length === 40)).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    expect(res.firstError).toBeNull();
    const lit = res.chars.join("").trim().length;
    expect(lit).toBeGreaterThan(20);
  });
});

describe("r14 perf refactor regressions", () => {
  const OPTS = {
    cols: 40,
    rows: 20,
    angleX: 0.5,
    angleY: 0.7,
    angleZ: 0,
    zoom: 1,
    light: [0.4, 0.6, -1] as [number, number, number],
    charset: A,
    samplesU: 40,
    samplesV: 40,
    aspect: 1.9,
    time: 0,
  };

  const paramDef = (code: string, scale = 1) => ({
    id: "r14",
    name: "r14",
    description: "",
    kind: "parametric" as const,
    code,
    uRange: [0, Math.PI * 2] as [number, number],
    vRange: [0, Math.PI * 2] as [number, number],
    scale,
  });

  it("sampler-applied scale matches code that pre-scales its output", () => {
    const byScale = paramDef("return [cos(u), sin(u), 0.5];", 2);
    const byCode = paramDef("return [2 * cos(u), 2 * sin(u), 1];", 1);
    // snapshot lum right after each render: renderFrame reuses one lum buffer
    // across calls (persistence 0), so the arrays would alias otherwise
    const a = renderFrame({ tag: "code", def: byScale, fn: compileSurface(byScale) }, OPTS);
    const aLum = Array.from(a.lum);
    const b = renderFrame({ tag: "code", def: byCode, fn: compileSurface(byCode) }, OPTS);
    expect(a.chars).toEqual(b.chars);
    expect(aLum).toEqual(Array.from(b.lum));
  });

  it("animated sampling over shared scratch leaves cached static geometry intact", () => {
    const staticDef = paramDef("return [(2 + cos(v)) * cos(u), sin(v), (2 + cos(v)) * sin(u)];");
    const fnS = compileSurface(staticDef);
    const animDef = paramDef(
      "const w = 1 + 0.3 * sin(t); return [(2 + cos(v)) * cos(u * w), sin(v), (2 + cos(v)) * sin(u * w)];",
    );
    const fnA = compileSurface(animDef);
    const first = renderFrame({ tag: "code", def: staticDef, fn: fnS }, OPTS);
    const firstLum = Array.from(first.lum);
    renderFrame({ tag: "code", def: animDef, fn: fnA }, { ...OPTS, time: 0.5 });
    renderFrame({ tag: "code", def: animDef, fn: fnA }, { ...OPTS, time: 1.2 });
    const again = renderFrame({ tag: "code", def: staticDef, fn: fnS }, OPTS);
    expect(again.chars).toEqual(first.chars);
    expect(Array.from(again.lum)).toEqual(firstLum);
  });

  it("editing code invalidates the compiled-artifact and planar caches", () => {
    const dark = {
      id: "p",
      name: "p",
      description: "",
      kind: "planar" as const,
      code: "return 0.15;",
      span: 4,
    };
    const bright = {
      id: "p",
      name: "p",
      description: "",
      kind: "planar" as const,
      code: "return 0.85;",
      span: 4,
    };
    const a1 = renderFrame({ tag: "code", def: dark, fn: null }, OPTS).chars.join("");
    const b1 = renderFrame({ tag: "code", def: bright, fn: null }, OPTS).chars.join("");
    const a2 = renderFrame({ tag: "code", def: dark, fn: null }, OPTS).chars.join("");
    expect(a1).not.toBe(b1); // same def id, different code → different picture
    expect(a2).toBe(a1); // …and the original def still renders its own output
  });

  it("implicit code renders through the lazy compile cache", () => {
    const def = {
      id: "i",
      name: "i",
      description: "",
      kind: "implicit" as const,
      code: "return x*x + y*y + z*z - 1.2;",
      bound: 1.6,
      iso: 0,
      quality: 24,
    };
    const a = renderFrame({ tag: "code", def, fn: null }, OPTS);
    const b = renderFrame({ tag: "code", def, fn: null }, OPTS);
    expect(a.points).toBeGreaterThan(0);
    expect(b.chars).toEqual(a.chars);
  });

  it("parametric code that throws reports the error on every frame (never cached as good)", () => {
    const def = paramDef("throw new Error('boom');");
    for (let i = 0; i < 2; i++) {
      const res = renderFrame({ tag: "code", def, fn: null }, OPTS);
      expect(res.firstError).toBe("boom");
      expect(res.thrown).toBe(OPTS.samplesU * OPTS.samplesV);
    }
  });

  it("charset ramps are indexed by UTF-16 code unit, lone surrogates included", () => {
    // " .😀" is 4 code units; the astral glyph's halves are addressable like any ramp entry
    const ramp = " .\u{1F600}";
    const lum = new Float32Array([-1, 0, 0.5, 1]);
    const line = charsFromLum(lum, 4, 1, ramp)[0];
    const pick = (l: number) =>
      ramp[Math.min(ramp.length - 1, Math.floor(l * (ramp.length - 1) + 0.5))];
    const expected = ` ${pick(0)}${pick(0.5)}${pick(1)}`;
    expect(line).toBe(expected);
    expect(line.length).toBe(4); // lone surrogate halves count as one unit each
  });
});

describe("generate emissive shading", () => {
  const OPTS = {
    cols: 40,
    rows: 20,
    angleX: 0.5,
    angleY: 0.7,
    angleZ: 0,
    zoom: 1,
    light: [0.4, 0.6, -1] as [number, number, number],
    charset: A,
    samplesU: 40,
    samplesV: 40,
    aspect: 1.9,
    time: 0,
  };

  const glowDef = (code: string) => ({
    id: "g",
    name: "g",
    description: "",
    kind: "generate" as const,
    code,
  });

  const drawnLums = (lum: Float32Array): number[] => Array.from(lum).filter((l) => l >= 0);

  it("glow-only generate shades from per-point luminance (and caches it)", () => {
    const def = glowDef(
      "for (let i = 0; i < 4; i++) { glow(-0.5, i * 0.05, 0, 0.9); glow(0.5, i * 0.05, 0, 0.1); }",
    );
    const first = renderFrame({ tag: "code", def, fn: null }, OPTS);
    const firstLum = Array.from(first.lum);
    const lit = firstLum.filter((l) => l >= 0);
    expect(lit.length).toBeGreaterThan(0);
    expect(Math.max(...lit)).toBeCloseTo(0.9, 5);
    expect(Math.min(...lit)).toBeCloseTo(0.1, 5);
    // the def is time-free → static → the second render comes from the geometry
    // cache and must reproduce the frame, per-point luminance included
    const againLum = Array.from(renderFrame({ tag: "code", def, fn: null }, OPTS).lum);
    const againChars = renderFrame({ tag: "code", def, fn: null }, OPTS).chars;
    expect(againChars).toEqual(first.chars);
    expect(againLum).toEqual(firstLum);
  });

  it("code mixing push and glow keeps lit shading", () => {
    const def = glowDef("push(0, 0, 0, 0, 0, 1); glow(0.5, 0, 0, 0.1); glow(-0.5, 0, 0, 0.9);");
    const res = renderFrame({ tag: "code", def, fn: null }, OPTS);
    const lit = drawnLums(res.lum);
    expect(lit.length).toBeGreaterThan(0);
    // lit path: every point shades identically (placeholder (0,0,1) normals),
    // the per-point glow luminances are not applied
    expect(new Set(lit).size).toBe(1);
  });

  it("native attractor brightness reaches the frame (regression: generate dropped per-point lum)", () => {
    const entry = findEntry("clifford");
    expect(entry?.tag).toBe("native");
    if (entry?.tag !== "native") return;
    // lum must be snapshotted per render — renderFrame reuses one lum buffer
    const dimLum = Array.from(
      renderFrame({ tag: "native", shape: entry.shape, params: { lum: 0.3 } }, OPTS).lum,
    );
    const brightLum = Array.from(
      renderFrame({ tag: "native", shape: entry.shape, params: { lum: 1 } }, OPTS).lum,
    );
    const lit = (a: number[]) => a.filter((l) => l >= 0);
    const dimMax = Math.max(...lit(dimLum));
    const brightMax = Math.max(...lit(brightLum));
    expect(dimMax).toBeGreaterThan(0.2);
    expect(dimMax).toBeLessThan(0.45);
    expect(brightMax).toBeGreaterThan(0.8);
    // clifford is static → this render hits the cache with its stored lum
    const againLum = Array.from(
      renderFrame({ tag: "native", shape: entry.shape, params: { lum: 1 } }, OPTS).lum,
    );
    expect(againLum).toEqual(brightLum);
  });
});
