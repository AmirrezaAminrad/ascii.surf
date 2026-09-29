import { describe, expect, it } from "vitest";
import { renderFrame, validateCodeSurface } from "../renderer";
import { defaultParams } from "../types";
import { barnsleyFern } from "./fractals";

const OPTS = {
  cols: 48,
  rows: 24,
  angleX: 0.5,
  angleY: 0.7,
  angleZ: 0.1,
  zoom: 1,
  light: [0.4, 0.6, -1] as [number, number, number],
  charset: ".,-~:;=!*#$@",
  samplesU: 48,
  samplesV: 24,
  aspect: 1.9,
  time: 1,
};

describe("barnsley fern code twin", () => {
  it("toCode output validates", () => {
    const def = barnsleyFern.toCode!(defaultParams(barnsleyFern.params));
    expect(() => validateCodeSurface(def)).not.toThrow();
  });

  // the twin must use the same PRNG as the native shape: same seed, same frond
  it("code twin reproduces the native frame", () => {
    const params = defaultParams(barnsleyFern.params);
    const native = renderFrame({ tag: "native", shape: barnsleyFern, params }, OPTS);
    const twin = renderFrame({ tag: "code", def: barnsleyFern.toCode!(params), fn: null }, OPTS);
    expect(native.points).toBeGreaterThan(0);
    expect(twin.chars).toEqual(native.chars);
  });
});
