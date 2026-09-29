/**
 * Live mode: the full-screen animated renderer — AsciiView's rAF loop
 * translated to a terminal. A drift-corrected timer advances the session,
 * paints ANSI frames into the alternate screen, and feeds raw stdin (keys +
 * SGR mouse) back into the same gesture model as the web app: hover moves the
 * pointer uniform, left-drag orbits with flick inertia, wheel zooms.
 */
import { CHARSETS } from "../../src/engine/presets";
import { SHAPES, entryId } from "../../src/engine/registry";
import type { Params, ShapeEntry } from "../../src/engine/types";
import { THEMES } from "../../src/themes";
import { clampZoom } from "../../src/view";
import type { CliOptions } from "./args";
import { entryScene, type Scene } from "./scene";
import { autoPointer, DEFAULT_CELL_ASPECT, RenderSession } from "./session";
import { frameToAnsi, parseInput, Terminal, type InputEvent } from "./terminal";

const COLOR_MODES = ["ramp", "rainbow", "plasma"] as const;
const NUDGE = 0.15;

export async function runLive(scene: Scene, opts: CliOptions): Promise<void> {
  const term = new Terminal();
  if (!term.enter()) {
    process.stderr.write("ascii-surf: stdout is not a terminal — use --once to print a frame\n");
    return;
  }
  if (!term.interactive) {
    process.stderr.write(
      "ascii-surf: stdin is not interactive (mintty/pipe) — rendering without input; Ctrl+C exits\n",
    );
  }

  const settings = scene.settings;
  settings.debug = opts.debug;
  const session = new RenderSession(scene.angles);
  if (opts.mouse) {
    session.mouse.x = opts.mouse[0];
    session.mouse.y = opts.mouse[1];
  }
  let shapeIdx = SHAPES.findIndex((e) => entryId(e) === scene.entryId);
  // --fps 0 would make the interval Infinity, which Node then fires every 1 ms
  const fps = Math.max(1, Math.min(120, Math.round(opts.fps ?? 30)));
  const interval = Math.max(8, Math.round(1000 / fps));

  let cols = 0;
  let rows = 0;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastFrame = performance.now();
  let fpsAcc = 0,
    fpsN = 0,
    lastStat = 0,
    msAvg = 0;
  let status = "";
  let drag: { x: number; y: number; t: number } | null = null;
  let resolveDone: (() => void) | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearInterval(timer);
    process.stdin.removeListener("data", onData);
    process.stdin.removeListener("end", onEnd);
    term.leave();
    resolveDone?.();
  };

  const applyEntry = (entry: ShapeEntry) => {
    const next = entryScene(entry, settings);
    scene.name = next.name;
    scene.entryId = next.entryId;
    scene.renderable = next.renderable;
    shapeIdx = SHAPES.findIndex((e) => entryId(e) === next.entryId);
  };

  const reroll = () => {
    applyEntry(SHAPES[Math.floor(Math.random() * SHAPES.length)]);
    settings.theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    if (scene.renderable.tag === "native") {
      const p: Params = { ...scene.renderable.params };
      for (const spec of scene.renderable.shape.params) {
        const v = spec.min + Math.random() * (spec.max - spec.min);
        p[spec.key] = spec.int ? Math.round(v) : v;
      }
      scene.renderable.params = p;
    }
  };

  const handleKey = (key: string) => {
    switch (key) {
      case "q":
      case "esc":
      case "ctrl+c":
        stop();
        return;
      case " ":
        settings.paused = !settings.paused;
        break;
      case "up":
      case "k":
        session.nudge(0, -NUDGE);
        break;
      case "down":
      case "j":
        session.nudge(0, NUDGE);
        break;
      case "left":
      case "h":
        session.nudge(-NUDGE, 0);
        break;
      case "right":
      case "l":
        session.nudge(NUDGE, 0);
        break;
      case "+":
      case "=":
        settings.zoom = clampZoom(settings.zoom * 1.12);
        break;
      case "-":
      case "_":
        settings.zoom = clampZoom(settings.zoom / 1.12);
        break;
      case "r":
        session.resetView();
        settings.zoom = 1;
        break;
      case "s":
        settings.autoRotate = !settings.autoRotate;
        break;
      case "o":
        settings.projection = settings.projection === "ortho" ? "perspective" : "ortho";
        break;
      case "m":
        settings.colorMode =
          COLOR_MODES[(COLOR_MODES.indexOf(settings.colorMode) + 1) % COLOR_MODES.length];
        break;
      case "f":
        settings.fog = settings.fog > 0 ? 0 : 0.6;
        break;
      case "d":
        settings.debug = !settings.debug;
        break;
      case "t": {
        const i = THEMES.findIndex((t) => t.name === settings.theme.name);
        settings.theme = THEMES[(Math.max(0, i) + 1) % THEMES.length];
        break;
      }
      case "c": {
        const i = CHARSETS.findIndex((k) => k.chars === settings.charset);
        settings.charset = CHARSETS[(Math.max(0, i) + 1) % CHARSETS.length].chars;
        break;
      }
      case "n":
        applyEntry(SHAPES[(shapeIdx + 1) % SHAPES.length] ?? SHAPES[0]);
        break;
      case "p":
        applyEntry(SHAPES[(shapeIdx - 1 + SHAPES.length) % SHAPES.length] ?? SHAPES[0]);
        break;
      case "x":
        reroll();
        break;
      default:
        if (/^[1-9]$/.test(key)) applyEntry(SHAPES[Number(key) - 1]);
        break;
    }
  };

  const handle = (ev: InputEvent) => {
    if (ev.kind === "key") {
      handleKey(ev.key);
      return;
    }
    const cx = Math.min(cols, Math.max(1, ev.x));
    const cy = Math.min(rows, Math.max(1, ev.y));
    switch (ev.action) {
      case "down":
        session.mouse.down = true;
        session.velocity = [0, 0];
        drag = { x: cx, y: cy, t: performance.now() };
        break;
      case "move":
        session.mouse.x = cols > 1 ? (cx - 1) / (cols - 1) : 0.5;
        session.mouse.y = rows > 1 ? (cy - 1) / (rows - 1) : 0.5;
        if (session.mouse.down && drag) {
          session.dragBy(cx - drag.x, cy - drag.y, performance.now() - drag.t);
          drag.x = cx;
          drag.y = cy;
          drag.t = performance.now();
        }
        break;
      case "up":
        session.mouse.down = false;
        drag = null; // released velocity keeps spinning via session.advance
        break;
      case "wheelup":
        settings.zoom = clampZoom(settings.zoom * 1.08);
        break;
      case "wheeldown":
        settings.zoom = clampZoom(settings.zoom * 0.92);
        break;
    }
  };

  // A lone ESC byte in a chunk is the Esc key (real escape sequences arrive
  // whole from a terminal); anything longer is kept as a partial-sequence carry.
  let carry = "";
  function onData(chunk: string): void {
    const parsed = parseInput(carry + chunk);
    if (parsed.rest === "\x1b") {
      carry = "";
      parsed.events.push({ kind: "key", key: "esc" });
    } else {
      carry = parsed.rest;
    }
    for (const ev of parsed.events) handle(ev);
  }
  const onEnd = () => stop();
  // decode on the stream: a multibyte char split across reads would turn into
  // U+FFFD with a per-chunk toString
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.on("end", onEnd);
  // raw mode turns Ctrl+C into a \x03 key (handled in handleKey), but the
  // non-interactive case documented in the README gets a real SIGINT — and
  // either way the terminal must be restored
  process.once("SIGINT", stop);
  process.once("SIGHUP", stop);

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    const sz = term.size();
    if (sz.cols !== cols || sz.rows !== rows) {
      cols = sz.cols;
      rows = sz.rows;
      term.out.write("\x1b[2J"); // shrinking would leave stale rows behind
    }

    if (opts.pointerAuto) {
      const p = autoPointer(now / 1000);
      session.mouse.x = p.x;
      session.mouse.y = p.y;
    }

    session.advance(dt, settings);
    const t0 = performance.now();
    const res = session.render(
      scene.renderable,
      cols,
      rows,
      settings,
      opts.aspect ?? DEFAULT_CELL_ASPECT,
    );
    msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1;
    fpsAcc += dt;
    fpsN++;

    if (res !== "idle") {
      term.out.write(
        frameToAnsi(res, settings, { bg: opts.bg !== false, home: true, time: now / 1000 }),
      );
    }
    if (settings.debug) {
      if (now - lastStat > 500) {
        const fps = (fpsN / (fpsAcc || 1)).toFixed(1);
        const pts = res === "idle" ? "idle" : `${res.points} pts`;
        status = `${fps} fps  ${msAvg.toFixed(1)} ms  ${pts}  ${cols}x${rows}  ${scene.name}  t=${session.time.toFixed(1)}s`;
        fpsAcc = 0;
        fpsN = 0;
        lastStat = now;
      }
      term.out.write(`\x1b[${rows + 1};1H\x1b[7m ${status} \x1b[0m\x1b[K`);
    }
  };

  try {
    await new Promise<void>((resolve) => {
      resolveDone = resolve;
      timer = setInterval(() => {
        try {
          tick();
        } catch (e) {
          // an escaping throw would become an uncaught exception and skip the
          // terminal restore — stop cleanly, then report on the restored screen
          stop();
          process.stderr.write(
            `ascii-surf: render loop failed: ${(e as Error)?.message ?? String(e)}\n`,
          );
        }
      }, interval);
    });
  } finally {
    stop(); // idempotent — also runs when the loop dies or a signal fires
  }
}
