import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("returns defaults for an empty argv", () => {
    const { opts, error } = parseArgs([]);
    expect(error).toBeNull();
    expect(opts!.shape).toBeNull();
    expect(opts!.set).toEqual([]);
    expect(opts!.once).toBe(false);
    expect(opts!.bg).toBeNull();
    expect(opts!.fps).toBeNull();
  });

  it("accepts --flag value and --flag=value", () => {
    const a = parseArgs(["--shape", "torus"]);
    expect(a.error).toBeNull();
    expect(a.opts!.shape).toBe("torus");
    const b = parseArgs(["--shape=lorenz"]);
    expect(b.error).toBeNull();
    expect(b.opts!.shape).toBe("lorenz");
  });

  it("accepts negative number values", () => {
    const { opts, error } = parseArgs(["--zoom", "-0.5", "--angle", "0.5,-1,2", "--spin=-.3,0,.3"]);
    expect(error).toBeNull();
    expect(opts!.zoom).toBe(-0.5);
    expect(opts!.angle).toEqual([0.5, -1, 2]);
    expect(opts!.spin).toEqual([-0.3, 0, 0.3]);
  });

  it("collects repeatable --set pairs", () => {
    const { opts } = parseArgs(["--set", "speed=2", "--set=seed=7"]);
    expect(opts!.set).toEqual([
      ["speed", 2],
      ["seed", 7],
    ]);
  });

  it("parses vec2 and enums", () => {
    const { opts } = parseArgs(["--mouse", "0.5,0.25", "--color", "plasma", "--format", "svg"]);
    expect(opts!.mouse).toEqual([0.5, 0.25]);
    expect(opts!.color).toBe("plasma");
    expect(opts!.format).toBe("svg");
  });

  it("treats --list without a value as shapes", () => {
    expect(parseArgs(["--list"]).opts!.list).toBe("shapes");
    expect(parseArgs(["--list", "themes"]).opts!.list).toBe("themes");
  });

  it("flips bg/bool pairs", () => {
    const { opts } = parseArgs(["--no-bg", "--ortho", "--pointer-auto"]);
    expect(opts!.bg).toBe(false);
    expect(opts!.ortho).toBe(true);
    expect(opts!.pointerAuto).toBe(true);
  });

  it("rejects unknown flags, missing values, and bad types", () => {
    expect(parseArgs(["--nope"]).error).toMatch(/unknown flag/);
    expect(parseArgs(["--zoom"]).error).toMatch(/requires a value/);
    expect(parseArgs(["--zoom", "--fps", "30"]).error).toMatch(/requires a value/);
    expect(parseArgs(["--zoom", "abc"]).error).toMatch(/number/);
    expect(parseArgs(["--once=1"]).error).toMatch(/takes no value/);
    expect(parseArgs(["--color", "nope"]).error).toMatch(/one of/);
    expect(parseArgs(["--angle", "1,2"]).error).toMatch(/3 comma-separated/);
    expect(parseArgs(["torus"]).error).toMatch(/unexpected argument/);
  });

  it("rejects blank numeric values instead of parsing them as 0", () => {
    expect(parseArgs(["--zoom="]).error).toMatch(/number/);
    expect(parseArgs(["--zoom", ""]).error).toMatch(/number/);
    expect(parseArgs(["--zoom", " "]).error).toMatch(/number/);
    expect(parseArgs(["--set", "speed="]).error).toMatch(/number/);
    expect(parseArgs(["--angle", "1,,2"]).error).toMatch(/3 comma-separated/);
    expect(parseArgs(["--angle", " "]).error).toMatch(/3 comma-separated/);
  });

  it("rejects --set without a key=value pair", () => {
    expect(parseArgs(["--set", "speed"]).error).toMatch(/key=value/);
    expect(parseArgs(["--set=speed"]).error).toMatch(/key=value/);
    expect(parseArgs(["--set", "=5"]).error).toMatch(/key=value/);
    expect(parseArgs(["--set", "speed=2"]).error).toBeNull();
  });
});
