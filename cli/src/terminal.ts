/**
 * Terminal plumbing: SGR-mouse/key input decoding, the ANSI truecolor frame
 * emitter, and the raw-mode terminal guard (alternate screen, cursor, mouse
 * tracking). The parsing and painting helpers are pure and unit-tested; the
 * Terminal class owns the side effects.
 */
import {
  PAL_STEPS,
  buildPlasmaRgb,
  buildRainbowRgb,
  buildRampRgb,
  hexToRgb,
} from "../../src/engine/exports";
import type { RenderResult } from "../../src/engine/renderer";
import type { ViewSettings } from "../../src/types";

// --- input decoding (pure) ---------------------------------------------------

type MouseAction = "down" | "move" | "up" | "wheelup" | "wheeldown";

export type InputEvent =
  { kind: "key"; key: string } | { kind: "mouse"; action: MouseAction; x: number; y: number }; // 1-based cell coords

const CSI_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
};
const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

export interface ParsedInput {
  events: InputEvent[];
  /** Incomplete escape sequence at the end of the chunk — prepend the next one. */
  rest: string;
}

export function parseInput(chunk: string): ParsedInput {
  const events: InputEvent[] = [];
  let i = 0;
  const n = chunk.length;
  while (i < n) {
    const c = chunk[i];
    if (c === "\x1b") {
      const tail = chunk.slice(i);
      if (incompleteEscape(tail)) return { events, rest: tail };
      if (chunk.startsWith("\x1b[<", i)) {
        const m = SGR_MOUSE.exec(tail);
        if (m) {
          const ev = sgrMouse(m[1], m[2], m[3], m[4]);
          if (ev) events.push(ev);
          i += m[0].length;
        } else {
          // malformed SGR-mouse prefix: drop the prefix, its digit/semicolon
          // run and the byte that broke it (where M/m belonged) — the rest of
          // the chunk must keep parsing, not vanish with the prefix
          i += 3;
          while (i < n && (chunk[i] === ";" || (chunk[i] >= "0" && chunk[i] <= "9"))) i++;
          if (i < n) i++;
        }
        continue;
      }
      if (chunk[i + 1] === "[") {
        let j = i + 2;
        while (j < n && !(chunk[j] >= "@" && chunk[j] <= "~")) j++;
        if (j < n) {
          const key = CSI_KEYS[chunk[j]];
          if (key) events.push({ kind: "key", key });
          i = j + 1;
        } else {
          i = n; // unterminated CSI (can't happen after incompleteEscape)
        }
        continue;
      }
      if (chunk[i + 1] === "O") {
        // SS3 (application cursor mode arrows)
        const key = CSI_KEYS[chunk[i + 2]];
        if (key) events.push({ kind: "key", key });
        i += 3;
        continue;
      }
      i += 1; // ESC + something else: drop the modifier, decode the rest
      continue;
    }
    if (c === "\x03") {
      events.push({ kind: "key", key: "ctrl+c" });
      i += 1;
      continue;
    }
    if (c === "\r") {
      events.push({ kind: "key", key: "enter" });
      i += 1;
      continue;
    }
    const cp = c.codePointAt(0)!;
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < n) {
      events.push({ kind: "key", key: chunk.slice(i, i + 2) }); // surrogate pair
      i += 2;
      continue;
    }
    events.push({ kind: "key", key: c });
    i += 1;
  }
  return { events, rest: "" };
}

/** True when the tail is a truncated escape sequence that needs more bytes. */
function incompleteEscape(tail: string): boolean {
  if (tail === "\x1b" || tail === "\x1b[" || tail === "\x1bO" || tail === "\x1b[<") return true;
  if (tail.startsWith("\x1b[<")) {
    // SGR mouse bodies are digits and semicolons only — any other byte (or an
    // overlong run) means malformed, not incomplete: stop waiting for bytes
    const body = tail.slice(3);
    return !/[^0-9;]/.test(body) && body.length <= 16;
  }
  if (tail.startsWith("\x1b[")) {
    const last = tail[tail.length - 1];
    return !(last >= "@" && last <= "~") && tail.length < 32;
  }
  return false;
}

function sgrMouse(b: string, xs: string, ys: string, suffix: string): InputEvent | null {
  const btn = parseInt(b, 10);
  const x = parseInt(xs, 10);
  const y = parseInt(ys, 10);
  let action: MouseAction;
  if (btn >= 64) {
    if (btn !== 64 && btn !== 65) return null; // horizontal wheel etc.
    action = btn === 64 ? "wheelup" : "wheeldown";
  } else if (suffix === "m" || (btn & 3) === 3) action = "up";
  else if (btn & 32) action = "move";
  else action = "down";
  return { kind: "mouse", action, x, y };
}

// --- ANSI frame emission (pure) ----------------------------------------------

export interface PaintOpts {
  /** Paint the theme background color behind empty cells. */
  bg: boolean;
  /** True → position the cursor at home first (live loop); false → raw rows. */
  home: boolean;
  /** Palette phase for the animated plasma color mode (seconds). */
  time: number;
}

/**
 * Truecolor frame emitter: the canvas drawing path translated to ANSI —
 * one background escape per frame, run-length fg color per luminance run,
 * rows joined with newline and cleared to EOL.
 */
export function frameToAnsi(res: RenderResult, s: ViewSettings, o: PaintOpts): string {
  const { cols, rows } = res;
  const th = s.theme;
  const ramp =
    s.colorMode === "rainbow"
      ? buildRainbowRgb()
      : s.colorMode === "plasma"
        ? buildPlasmaRgb(th.fg, o.time)
        : th.mode === "heat"
          ? buildRampRgb(th.bg, th.fg, th.glow)
          : null; // mono theme + ramp mode → single fg color
  const [fr, fgc, fb] = hexToRgb(th.fg);
  const maxIdx = PAL_STEPS - 1;

  let out = o.home ? "\x1b[H" : "";
  if (o.bg) {
    const [bgr, bgg, bgb] = hexToRgb(th.bg);
    out += `\x1b[48;2;${bgr};${bgg};${bgb}m`;
  }
  for (let row = 0; row < rows; row++) {
    const line = res.chars[row] ?? "";
    let lastIdx = -2;
    for (let c = 0; c < cols; c++) {
      const chr = line[c] ?? " ";
      const l = res.lum[row * cols + c];
      if (chr === " " || l < 0) {
        out += " ";
        lastIdx = -2;
        continue;
      }
      const idx = ramp ? Math.max(0, Math.min(maxIdx, Math.round(l * maxIdx))) : -1;
      if (idx !== lastIdx) {
        const rgb = ramp ? ramp[idx] : [fr, fgc, fb];
        out += `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
        lastIdx = idx;
      }
      out += chr;
    }
    out += "\x1b[K";
    if (row < rows - 1) out += "\n";
  }
  return out + "\x1b[0m";
}

// --- terminal guard (side effects) -------------------------------------------

const ALT_ENTER = "\x1b[?1049h\x1b[2J\x1b[H";
const ALT_EXIT = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const MOUSE_ON = "\x1b[?1000h\x1b[?1003h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1000l";

export class Terminal {
  readonly out = process.stdout;
  /** Raw stdin works → keys and mouse available. */
  interactive = false;
  private entered = false;

  /** Enter the alternate screen; false when stdout is not a TTY. */
  enter(): boolean {
    if (!this.out.isTTY) return false;
    this.out.write(ALT_ENTER + CURSOR_HIDE);
    this.entered = true;
    try {
      process.stdin.setRawMode(true);
      this.interactive = true;
    } catch {
      this.interactive = false; // e.g. mintty/pipe stdin: render but no input
    }
    if (this.interactive) {
      process.stdin.resume();
      this.out.write(MOUSE_ON);
    }
    return true;
  }

  leave(): void {
    if (this.interactive) {
      this.out.write(MOUSE_OFF);
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* already gone */
      }
      process.stdin.pause();
      this.interactive = false;
    }
    if (this.entered) {
      this.out.write(CURSOR_SHOW + ALT_EXIT);
      this.entered = false;
    }
  }

  /** Full grid size minus one line (the last line scrolls — and hosts --debug). */
  size(): { cols: number; rows: number } {
    return {
      cols: Math.max(20, this.out.columns || 80),
      rows: Math.max(8, (this.out.rows || 24) - 1),
    };
  }
}
