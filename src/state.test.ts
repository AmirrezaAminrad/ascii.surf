import { describe, expect, it } from "vitest";
import { decodeState, encodeState, sanitizeParamValues } from "./state";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "./view";
import { CHARSETS, PRESETS } from "./engine/presets";
import type { Params } from "./engine/types";

type StoredState = Parameters<typeof encodeState>[0];

describe("state codec", () => {
  it("round-trips a stored state through base64url", () => {
    const state = {
      v: 2,
      entryId: PRESETS[0].id,
      def: PRESETS[0],
      code: PRESETS[0].code,
      paramValues: { torus: { p: 2, q: 3 } },
      settings: { themeName: "Phosphor" },
    } as unknown as StoredState;
    const encoded = encodeState(state);
    expect(encoded).not.toMatch(/[+/=]/); // URL-safe alphabet
    const decoded = decodeState(encoded);
    expect(decoded).toEqual(state);
  });

  it("survives unicode payloads", () => {
    const state = {
      v: 2,
      entryId: "x·yz ✓",
      settings: { themeName: "冰雪" },
    } as unknown as StoredState;
    expect(decodeState(encodeState(state))).toEqual(state);
  });

  it("returns null on malformed input", () => {
    expect(decodeState("not-base64!!!")).toBeNull();
    expect(decodeState("")).toBeNull();
  });
});

describe("sanitizeParamValues", () => {
  it("keeps finite numbers and drops everything else", () => {
    expect(
      sanitizeParamValues({
        a: { keep: 1.5, nan: NaN, inf: Infinity, negInf: -Infinity },
        b: { text: "1" as unknown as number },
        c: null as unknown as Params,
      }),
    ).toEqual({ a: { keep: 1.5 }, b: {} });
    expect(sanitizeParamValues(undefined)).toEqual({});
  });
});

describe("AsciiView helpers", () => {
  it("clamps zoom to the configured bounds", () => {
    expect(clampZoom(-5)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });
});

describe("presets & charsets data integrity", () => {
  it("charsets are non-empty and uniquely named", () => {
    expect(CHARSETS.length).toBeGreaterThanOrEqual(7);
    expect(new Set(CHARSETS.map((c) => c.name)).size).toBe(CHARSETS.length);
    for (const c of CHARSETS) expect(c.chars.length).toBeGreaterThan(0);
  });

  it("presets carry editable code with distinct ids", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.code.length).toBeGreaterThan(0);
  });
});
