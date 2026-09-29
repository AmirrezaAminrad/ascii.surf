import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/state";
import type { RenderResult } from "../../src/engine/renderer";
import { THEMES } from "../../src/themes";
import { frameToAnsi, parseInput } from "./terminal";

describe("parseInput", () => {
  it("decodes arrow and control keys", () => {
    expect(parseInput("\x1b[A")).toEqual({ events: [{ kind: "key", key: "up" }], rest: "" });
    expect(parseInput("\x1b[B").events[0]).toEqual({ kind: "key", key: "down" });
    expect(parseInput("\x1b[C").events[0]).toEqual({ kind: "key", key: "right" });
    expect(parseInput("\x1b[D").events[0]).toEqual({ kind: "key", key: "left" });
    expect(parseInput("\x1bOA").events[0]).toEqual({ kind: "key", key: "up" }); // SS3 arrows
    expect(parseInput("\x03").events[0]).toEqual({ kind: "key", key: "ctrl+c" });
    expect(parseInput("q ").events).toEqual([
      { kind: "key", key: "q" },
      { kind: "key", key: " " },
    ]);
  });

  it("decodes SGR mouse events", () => {
    expect(parseInput("\x1b[<0;10;5M").events[0]).toEqual({
      kind: "mouse",
      action: "down",
      x: 10,
      y: 5,
    });
    expect(parseInput("\x1b[<0;10;5m").events[0]).toEqual({
      kind: "mouse",
      action: "up",
      x: 10,
      y: 5,
    });
    expect(parseInput("\x1b[<32;3;4M").events[0]).toEqual({
      kind: "mouse",
      action: "move",
      x: 3,
      y: 4,
    });
    expect(parseInput("\x1b[<64;2;2M").events[0]).toEqual({
      kind: "mouse",
      action: "wheelup",
      x: 2,
      y: 2,
    });
    expect(parseInput("\x1b[<65;2;2M").events[0]).toEqual({
      kind: "mouse",
      action: "wheeldown",
      x: 2,
      y: 2,
    });
  });

  it("holds incomplete escapes and resyncs after malformed ones", () => {
    expect(parseInput("\x1b")).toEqual({ events: [], rest: "\x1b" });
    expect(parseInput("\x1b[")).toEqual({ events: [], rest: "\x1b[" });
    expect(parseInput("\x1b[<0;10")).toEqual({ events: [], rest: "\x1b[<0;10" });
    // a malformed SGR-mouse body only costs the prefix and its garbage run —
    // a real key following it (the q) must survive
    expect(parseInput("\x1b[<999;999;999Xq").events).toEqual([{ kind: "key", key: "q" }]);
  });
});

const frame: RenderResult = {
  chars: [" # ", "###"],
  lum: new Float32Array([-1, 0.5, 1, 0, 0.25, -1]),
  cols: 3,
  rows: 2,
  points: 5,
  thrown: 0,
  firstError: null,
};

const monoSettings = { ...DEFAULT_SETTINGS, theme: THEMES.find((t) => t.name === "Mono")! };

describe("frameToAnsi", () => {
  it("colors runs by luminance and leaves empty cells plain (mono theme)", () => {
    const out = frameToAnsi(frame, monoSettings, { bg: false, home: false, time: 0 });
    expect(out).toContain("\x1b[38;2;229;229;229m"); // Mono fg #e5e5e5
    expect(out).not.toContain("\x1b[48;2;"); // background off
    expect(out).toContain("\x1b[K");
    expect(out.endsWith("\x1b[0m")).toBe(true);
  });

  it("paints the theme background and homes the cursor when asked", () => {
    const out = frameToAnsi(frame, monoSettings, { bg: true, home: true, time: 0 });
    expect(out.startsWith("\x1b[H\x1b[48;2;0;0;0m")).toBe(true);
  });

  it("maps heat themes through the bg→fg→glow ramp", () => {
    const heat = { ...DEFAULT_SETTINGS, theme: THEMES[0] }; // Phosphor (heat)
    const out = frameToAnsi(frame, heat, { bg: false, home: false, time: 0 });
    const colors = new Set(out.match(/\x1b\[38;2;(\d+;\d+;\d+)m/g) ?? []);
    expect(colors.size).toBeGreaterThanOrEqual(3); // luminances 0, 0.25, 0.5, 1
  });
});
