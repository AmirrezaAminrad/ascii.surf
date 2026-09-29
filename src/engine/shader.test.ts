import { describe, expect, it } from "vitest";
import { codeAnimated, renderFrame, validateCodeSurface } from "./renderer";
import { SHADER_PRESETS } from "./presets";
import type { SurfaceDef } from "./types";

const CHARSET = ".,-~:;=!*#$@";

function shader(code: string, span = 4): SurfaceDef {
  return {
    id: "test-shader",
    name: "Test Shader",
    kind: "planar",
    code,
    span,
    description: "test",
  };
}

function render(
  def: SurfaceDef,
  opts: {
    zoom?: number;
    mouse?: { x: number; y: number };
    time?: number;
    cols?: number;
    rows?: number;
  } = {},
) {
  return renderFrame(
    { tag: "code", def, fn: null },
    {
      cols: opts.cols ?? 8,
      rows: opts.rows ?? 4,
      angleX: 0,
      angleY: 0,
      angleZ: 0,
      zoom: opts.zoom ?? 1,
      light: [0.4, 0.6, -1],
      charset: CHARSET,
      samplesU: 8,
      samplesV: 4,
      aspect: 2,
      time: opts.time ?? 0,
      ...(opts.mouse ? { mouse: opts.mouse } : {}),
    },
  );
}

describe("planar shader bindings", () => {
  it("exposes cols, rows, aspect to the code", () => {
    const res = render(shader("return cols === 8 && rows === 4 && aspect === 2 ? 1 : NaN;"));
    expect(res.points).toBe(32);
  });

  it("maps mouse to shader coords (mx right, my up, same span as u/v)", () => {
    // span 4, cols 8 / rows 4, aspect 2 → hspan 4; mouse (0.75, 0.75) → mx=1, my=-1
    const res = render(shader("return mx > 0.5 && my < -0.5 ? 1 : NaN;"), {
      mouse: { x: 0.75, y: 0.75 },
    });
    expect(res.points).toBeGreaterThan(0);
    // default (no pointer yet) is the center: mx = my = 0
    const idle = render(shader("return mx === 0 && my === 0 ? 1 : NaN;"));
    expect(idle.points).toBe(32);
  });

  it("exposes view zoom", () => {
    const res = render(shader("return zoom === 2 ? 1 : NaN;"), { zoom: 2 });
    expect(res.points).toBe(32);
  });

  it("zoom frames the shader (span divides by it)", () => {
    const disc = shader("return hypot(u, v) < 1 ? 1 : NaN;");
    const wide = render(disc, { zoom: 1 });
    const close = render(disc, { zoom: 2 });
    expect(close.points).toBeGreaterThan(wide.points);
  });

  it("treats NaN as an empty cell", () => {
    const res = render(shader("return NaN;"));
    expect(res.points).toBe(0);
    expect(res.chars.every((l) => l.trim() === "")).toBe(true);
    // and validation accepts it — sky/empty is a legitimate design choice
    expect(() => validateCodeSurface(shader("return NaN;"))).not.toThrow();
    expect(() => validateCodeSurface(shader("return undefined;"))).toThrow();
  });
});

describe("planar frame feedback (prev)", () => {
  // a first all-empty frame resets the prev buffer (module state shared by tests)
  const blank = shader("return NaN;");

  it("feeds each frame's field into the next frame's prev(u, v)", () => {
    render(blank);
    const grow = shader("return prev(u, v) + 0.25;");
    const f1 = render(grow);
    expect(f1.lum[0]).toBeCloseTo(0.25, 10);
    const f2 = render(grow);
    expect(f2.lum[0]).toBeCloseTo(0.5, 10);
    const f3 = render(grow);
    expect(f3.lum[0]).toBeCloseTo(0.75, 10);
  });

  it("reads zero outside the grid and for empty cells", () => {
    render(blank);
    const res = render(shader("return prev(99, 99) + prev(u, v) * 0 + 0.5;"));
    expect(res.lum[0]).toBeCloseTo(0.5, 10);
  });

  it("resets when the grid is resized", () => {
    render(blank, { cols: 8, rows: 4 });
    const grow = shader("return prev(u, v) + 0.25;");
    render(grow, { cols: 8, rows: 4 });
    render(grow, { cols: 8, rows: 4 });
    const after = render(grow, { cols: 6, rows: 4 });
    expect(after.lum[0]).toBeCloseTo(0.25, 10);
  });
});

describe("shader animation detection", () => {
  it("stays static for pure u/v code and animates for t/mx/my/prev", () => {
    expect(codeAnimated(shader("return hypot(u, v);"))).toBe(false);
    expect(codeAnimated(shader("return sin(t);"))).toBe(true);
    expect(codeAnimated(shader("return mx + my;"))).toBe(true);
    expect(codeAnimated(shader("return prev(u, v);"))).toBe(true);
    // other kinds keep their old rule
    expect(codeAnimated({ ...shader("return 1;"), kind: "implicit" })).toBe(false);
  });
});

describe("shader presets", () => {
  it("validates and renders a non-empty frame from defaults", () => {
    for (const def of SHADER_PRESETS) {
      expect(() => validateCodeSurface(def), def.id).not.toThrow();
      if (def.id === "ascii-ink") {
        // feedback scene: let a couple of frames accumulate first
        render(def, { cols: 48, rows: 24, time: 0.5 });
      }
      const res = render(def, { cols: 48, rows: 24, time: 0.5 });
      expect(res.points, def.id).toBeGreaterThan(0);
      expect(
        res.chars.every((l) => l.length === 48),
        def.id,
      ).toBe(true);
    }
  });
});
