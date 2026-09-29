import { describe, expect, it } from "vitest";
import { renderFrame, validateCodeSurface } from "../renderer";
import { defaultParams, type Params, type Shape } from "../types";
import { clifford, dejong, hopf } from "./attractors";

const SHAPES = [clifford, dejong, hopf];

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

/** Native frame vs its editable-code twin: identical geometry ⇒ identical glyphs. */
function twinFrame(shape: Shape, params: Params) {
  return renderFrame({ tag: "code", def: shape.toCode!(params), fn: null }, OPTS);
}

describe("attractor code twins", () => {
  it("toCode output validates", () => {
    for (const shape of SHAPES) {
      const def = shape.toCode!(defaultParams(shape.params));
      expect(() => validateCodeSurface(def), shape.id).not.toThrow();
    }
  });

  it("code twin reproduces the native frame", () => {
    for (const shape of SHAPES) {
      const params = defaultParams(shape.params);
      const native = renderFrame({ tag: "native", shape, params }, OPTS);
      expect(native.points, `${shape.id} native frame has ink`).toBeGreaterThan(0);
      expect(twinFrame(shape, params).chars, shape.id).toEqual(native.chars);
    }
  });
});
