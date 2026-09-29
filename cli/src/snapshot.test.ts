import { describe, expect, it } from "vitest";
import { buildScene } from "./scene";
import { parseArgs, type CliOptions } from "./args";
import { renderSnapshot, type OutputFormat } from "./snapshot";

function optsOf(argv: string): CliOptions {
  const { opts, error } = parseArgs(argv.split(" ").filter(Boolean));
  if (error !== null || opts === null) throw new Error(error ?? "unreachable");
  return opts;
}

function snap(argv: string, cols = 40, rows = 14, format: OutputFormat = "txt"): string {
  return renderSnapshot(buildScene(optsOf(argv)), optsOf(argv), cols, rows, format);
}

describe("renderSnapshot", () => {
  // SHAPES[0] is a parametric code surface — stateless, so two renders of the
  // same options in one process are byte-identical.
  it("renders a trimmed plain-text frame", () => {
    const out = snap("--shape 1 --time 0.5");
    const lines = out.split("\n");
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
    expect(out).toMatch(/[.,:;=!*#@~-]/); // the classic charset
  });

  it("is deterministic for a static shape", () => {
    expect(snap("--shape 1 --time 0.5")).toBe(snap("--shape 1 --time 0.5"));
  });

  it("develops simulations with --warmup", () => {
    const out = snap("--shape lorenz --warmup 40 --time 0", 60, 20);
    const ink = [...out].filter((c) => c !== " " && c !== "\n").length;
    expect(ink).toBeGreaterThan(50);
  });

  it("formats ansi, html, and svg", () => {
    const ansi = snap("--shape 1 --time 0.5", 40, 14, "ansi");
    expect(ansi).toContain("\x1b[38;2;"); // truecolor fg runs
    expect(ansi).toContain("\x1b[48;2;"); // theme background painted
    expect(ansi.endsWith("\x1b[0m")).toBe(true);

    const html = snap("--shape 1 --time 0.5", 40, 14, "html");
    expect(html.startsWith("<pre")).toBe(true);

    const svg = snap("--shape 1 --time 0.5", 40, 14, "svg");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("honors a fixed --mouse position", () => {
    // the torus ignores the pointer; the flag must flow through without error
    expect(snap("--shape 1 --time 0.5")).toBe(snap("--shape 1 --time 0.5 --mouse 0.25,0.75"));
  });
});
