/**
 * One-shot mode: render a single frame at a fixed grid and format it as
 * txt/ansi/html/svg. Pure apart from nothing — main.ts owns the file write —
 * so the whole path is unit-testable end to end.
 */
import { frameHtml, frameSvg, trimFrame } from "../../src/engine/exports";
import type { ViewSettings } from "../../src/types";
import type { CliOptions } from "./args";
import { autoPointer, DEFAULT_CELL_ASPECT, RenderSession } from "./session";
import type { Scene } from "./scene";
import { frameToAnsi } from "./terminal";

const WARMUP_DT = 1 / 30;

export type OutputFormat = "txt" | "ansi" | "html" | "svg";

/**
 * Render one frame and return it formatted (no trailing newline).
 * `--time` pins the surface time; `--warmup N` steps N simulated frames first
 * so trails/flocks/fields arrive developed. Repeated runs of the same sim
 * shape in one process continue its cached state — the engine keys sim
 * instances by shape+params, not per call.
 */
export function renderSnapshot(
  scene: Scene,
  opts: CliOptions,
  cols: number,
  rows: number,
  format: OutputFormat,
): string {
  const settings: ViewSettings = scene.settings;
  const session = new RenderSession(scene.angles);
  const aspect = opts.aspect ?? DEFAULT_CELL_ASPECT;
  if (opts.mouse) {
    session.mouse.x = opts.mouse[0];
    session.mouse.y = opts.mouse[1];
  } else if (opts.pointerAuto) {
    const t = opts.time ?? 0;
    const p = autoPointer(t);
    session.mouse.x = p.x;
    session.mouse.y = p.y;
  }

  const warmup = Math.max(0, Math.round(opts.warmup ?? 0));
  for (let i = 0; i < warmup; i++) {
    session.advance(WARMUP_DT, settings);
    session.render(scene.renderable, cols, rows, settings, aspect);
  }
  if (opts.time !== null) session.time = opts.time;
  // dt = 0: pin the sim to its warmed-up state instead of stepping once more
  session.advance(0, settings);
  const res = session.render(scene.renderable, cols, rows, settings, aspect);
  if (res === "idle") throw new Error("internal: first render reported idle");

  switch (format) {
    case "txt":
      return trimFrame(res.chars);
    case "ansi":
      return frameToAnsi(res, settings, { bg: opts.bg !== false, home: false, time: session.time });
    case "html":
      return frameHtml(res.chars, res.lum, {
        bg: settings.theme.bg,
        fg: settings.theme.fg,
        glow: settings.theme.glow,
        mode: settings.theme.mode,
        colorMode: settings.colorMode,
      });
    case "svg":
      return frameSvg(res.chars, res.lum, {
        bg: settings.theme.bg,
        fg: settings.theme.fg,
        glow: settings.theme.glow,
        mode: settings.theme.mode,
        colorMode: settings.colorMode,
      });
  }
}
