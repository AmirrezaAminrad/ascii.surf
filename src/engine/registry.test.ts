import { describe, expect, it } from "vitest";
import { renderFrame, validateCodeSurface } from "./renderer";
import { CATEGORIES, defaultParams } from "./types";
import { SHAPES, entryCategory, entryId, entriesInCategory, findEntry } from "./registry";

const CHARSET = ".,-~:;=!*#$@";

describe("registry integrity", () => {
  it("has a healthy number of shapes with unique ids", () => {
    expect(SHAPES.length).toBeGreaterThan(40);
    const ids = SHAPES.map(entryId);
    expect(new Set(ids).size).toBe(SHAPES.length);
  });

  it("every code preset validates", () => {
    for (const e of SHAPES) {
      if (e.tag !== "code") continue;
      expect(() => validateCodeSurface(e.def), e.def.name).not.toThrow();
    }
  });

  it("categories partition the registry", () => {
    let total = 0;
    for (const c of CATEGORIES) {
      for (const e of entriesInCategory(c)) {
        expect(entryCategory(e)).toBe(c);
        total++;
      }
    }
    expect(total).toBe(SHAPES.length);
  });

  it("findEntry round-trips entryId", () => {
    for (const e of SHAPES) {
      const found = findEntry(entryId(e));
      expect(found).toBeDefined();
      expect(entryId(found!)).toBe(entryId(e));
    }
    expect(findEntry("no-such-id")).toBeNull();
  });

  it("native shapes keep parameter defaults in range", () => {
    for (const e of SHAPES) {
      if (e.tag !== "native") continue;
      for (const s of e.shape.params) {
        expect(s.min).toBeLessThanOrEqual(s.max);
        expect(s.step).toBeGreaterThan(0);
        expect(s.def).toBeGreaterThanOrEqual(s.min);
        expect(s.def).toBeLessThanOrEqual(s.max);
        const p = defaultParams(e.shape.params)[s.key];
        expect(Number.isFinite(p)).toBe(true);
      }
    }
  });

  it("every native shape renders a frame from default params without throwing", () => {
    for (const e of SHAPES) {
      if (e.tag !== "native") continue;
      const params = defaultParams(e.shape.params);
      const res = renderFrame(
        { tag: "native", shape: e.shape, params },
        {
          cols: 48,
          rows: 24,
          angleX: 0.5,
          angleY: 0.7,
          angleZ: 0,
          zoom: 1,
          light: [0.4, 0.6, -1],
          charset: CHARSET,
          samplesU: 48,
          samplesV: 24,
          aspect: 1.9,
          time: 0.5,
          dt: 0.016,
        },
      );
      expect(res.chars).toHaveLength(24);
      // a shape may legitimately report evaluation issues on part of its grid,
      // but producing zero drawn points is a regression
      expect(res.points, e.shape.id).toBeGreaterThan(0);
      expect(res.chars.every((l) => l.length === 48)).toBe(true);
    }
  });
});
