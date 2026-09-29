import { describe, expect, it } from "vitest";
import { codeAnimated, renderFrame, validateCodeSurface } from "../renderer";
import { defaultParams, makeFrame, type Pointer, type Shape } from "../types";
import { asciiCursor, asciiRipple, asciiTiles, asciiWaves, liquidAscii } from "./effects";

const EFFECTS = [asciiRipple, liquidAscii, asciiWaves, asciiTiles, asciiCursor];

const COLS = 64;
const ROWS = 32;
const ASPECT = 1.9;

/** A pointer sweeping across the viewport, pressing every third frame. */
const pointerSeq = (frame: number): Pointer => ({
  x: 0.2 + (((frame * 3) % 20) / 20) * 0.6,
  y: 0.3 + (((frame * 7) % 20) / 20) * 0.4,
  down: frame % 3 === 0,
});

const IDLE_POINTER: Pointer = { x: 0.5, y: 0.5, down: false };

function fieldStats(out: Float32Array): { lit: number; lo: number; hi: number } {
  let lit = 0;
  let lo = 2;
  let hi = -2;
  for (const l of out) {
    expect(l === -1 || (Number.isFinite(l) && l >= 0 && l <= 1)).toBe(true);
    if (l >= 0) {
      lit++;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
  }
  return { lit, lo, hi };
}

function stepFrames(
  shape: Shape,
  frames: number,
  pointerAt: (f: number) => Pointer,
  out: Float32Array,
): void {
  const sim = shape.sim!(defaultParams(shape.params), 42);
  for (let f = 0; f < frames; f++) {
    sim.step(1 / 60, f / 60, makeFrame(16), pointerAt(f));
    sim.planar!(COLS, ROWS, ASPECT, out, pointerAt(f));
  }
}

describe("interactive ascii effects", () => {
  it("sims produce lit, clamped fields that follow the pointer", () => {
    for (const shape of EFFECTS) {
      if (!shape.sim) continue;
      const moving = new Float32Array(COLS * ROWS);
      const idle = new Float32Array(COLS * ROWS);
      stepFrames(shape, 40, pointerSeq, moving);
      stepFrames(shape, 40, () => IDLE_POINTER, idle);
      const a = fieldStats(moving);
      expect(a.lit, shape.id).toBeGreaterThan(0);
      let diff = 0;
      for (let i = 0; i < moving.length; i++) diff += Math.abs(moving[i] - idle[i]);
      expect(diff, `${shape.id} must react to pointer motion`).toBeGreaterThan(1);
    }
  });

  it("planar effects fill a clamped, varying field", () => {
    for (const shape of EFFECTS) {
      if (!shape.planar) continue;
      const out = new Float32Array(COLS * ROWS);
      shape.planar!(defaultParams(shape.params), 1.5, COLS, ROWS, ASPECT, out, pointerSeq(3));
      const { lit, lo, hi } = fieldStats(out);
      expect(lit, shape.id).toBe(COLS * ROWS); // full-viewport fields, no empty cells
      expect(hi - lo, shape.id).toBeGreaterThan(0.2);
    }
  });

  it("every editable-code equivalent validates and animates", () => {
    for (const shape of EFFECTS) {
      const def = shape.toCode!(defaultParams(shape.params));
      expect(() => validateCodeSurface(def), shape.id).not.toThrow();
      expect(codeAnimated(def), shape.id).toBe(true);
    }
  });

  it("renders through renderFrame with a pressed pointer", () => {
    for (const shape of EFFECTS) {
      const res = renderFrame(
        { tag: "native", shape, params: defaultParams(shape.params) },
        {
          cols: 48,
          rows: 24,
          angleX: 0.5,
          angleY: 0.7,
          angleZ: 0,
          zoom: 1,
          light: [0.4, 0.6, -1],
          charset: ".,-~:;=!*#$@",
          samplesU: 48,
          samplesV: 24,
          aspect: 1.9,
          time: 0.5,
          dt: 0.016,
          mouse: { x: 0.35, y: 0.45, down: true },
        },
      );
      expect(res.chars).toHaveLength(24);
      expect(res.firstError, shape.id).toBeNull();
      expect(res.points, shape.id).toBeGreaterThan(0);
    }
  });
});
