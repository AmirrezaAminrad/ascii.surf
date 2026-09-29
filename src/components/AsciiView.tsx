import { useEffect, useRef } from "react";
import {
  PAL_STEPS,
  buildPlasmaRgb,
  buildRampRgb,
  buildRainbowRgb,
  hexToRgb,
} from "../engine/exports";
import { charsFromLum, renderFrame, type RenderOptions } from "../engine/renderer";
import type { Renderable, Vec3 } from "../engine/types";
import type { Stats, ViewApi, ViewSettings } from "../types";
import type { Theme } from "../themes";
import { clampZoom, HOME_ANGLES, viewSig } from "../view";

interface Props {
  name: string;
  entryKey: string; // identity of the active shape — keying the switch dissolve
  renderable: Renderable;
  settings: ViewSettings;
  frameRef: React.MutableRefObject<string[]>;
  lumRef: React.MutableRefObject<Float32Array>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  apiRef: React.MutableRefObject<ViewApi | null>;
  onZoom: (v: number) => void;
  onStats: (s: Stats) => void;
  onError: (msg: string | null) => void;
}

function buildPalette(bgHex: string, fgHex: string, glowHex: string): string[] {
  return buildRampRgb(bgHex, fgHex, glowHex).map(([r, g, b]) => `rgb(${r},${g},${b})`);
}

// Font string + cell width per fontSize, measured once (measureText every frame
// forced a synchronous layout-affecting query into the hot loop).
const fontCache = new Map<number, { font: string; cw: number }>();
function fontMetrics(fs: number): { font: string; cw: number } {
  let m = fontCache.get(fs);
  if (!m) {
    const font = `${fs}px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`;
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.font = font;
    m = { font, cw: probe.measureText("M").width };
    fontCache.set(fs, m);
  }
  return m;
}

/** True if the row has any non-space cell (cheap scan; trim() allocated per row per frame). */
function hasInk(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (line[i] !== " ") return true;
  return false;
}

/** Short color crossfade for charset/theme switches (skipped under reduced motion). */
const FADE_MS = 400;
/** Live read so toggling the OS reduce-motion setting takes effect without a reload. */
const reducedMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

export default function AsciiView({
  name,
  entryKey,
  renderable,
  settings,
  frameRef,
  lumRef,
  canvasRef,
  apiRef,
  onZoom,
  onStats,
  onError,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const angles = useRef<[number, number, number]>([...HOME_ANGLES]);
  const velocity = useRef<[number, number]>([0, 0]);
  const time = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const settingsRef = useRef(settings);
  const renderableRef = useRef(renderable);
  const onZoomRef = useRef(onZoom);
  // crossfade sources (charset dither / theme color lerp / shape-switch ghost) —
  // plain refs so the render effect never needs them as deps
  const prevCharset = useRef(settings.charset);
  const charsetFade = useRef<{ from: string; start: number } | null>(null);
  const prevTheme = useRef(settings.theme);
  const themeFade = useRef<{ from: Theme; start: number } | null>(null);
  const prevEntryKey = useRef(entryKey);
  const entryKeyRef = useRef(entryKey);
  const shapeFade = useRef<{ lum: Float32Array; start: number; cols: number; rows: number } | null>(
    null,
  );
  // coalesced zoom target: wheel/pinch write it, the rAF loop commits at most
  // one zoom change per frame (a commit re-renders the whole app tree)
  const pendingZoom = useRef<number | null>(null);
  settingsRef.current = settings;
  renderableRef.current = renderable;
  onZoomRef.current = onZoom;
  entryKeyRef.current = entryKey;

  useEffect(() => {
    apiRef.current = {
      resetView: () => {
        angles.current = [...HOME_ANGLES];
        velocity.current = [0, 0];
        pendingZoom.current = null; // a stale pending target must not clobber the reset
        onZoomRef.current(1);
      },
      resetTime: () => {
        time.current = 0;
      },
      nudge: (dx, dy) => {
        angles.current[1] += dx;
        angles.current[0] += dy;
        velocity.current = [0, 0];
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let fpsAcc = 0,
      fpsN = 0,
      lastStat = 0;
    let msAvg = 0,
      engineAvg = 0,
      drawAvg = 0;
    // reduced-motion is read live so a mid-session OS toggle applies immediately
    let reducedMotion = reducedMotionQuery?.matches ?? false;
    const onReducedMotion = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    reducedMotionQuery?.addEventListener("change", onReducedMotion);
    let palette: string[] = [];
    let paletteKey = "";
    let errActive = false;
    let lastErrReport = 0;
    let lastCols = -1;
    let lastRows = -1;
    // idle-skip bookkeeping: signature + static flag of the last drawn frame
    let lastSig = "";
    let lastStatic = false;
    let lastR: Renderable | null = null;
    let points = 0;
    // dissolve scratch — grown with the grid, reused across the 400 ms fades
    let blendBuf = new Float32Array(0);
    // one options object, mutated per frame (renderFrame never retains it)
    const opt = {
      cols: 0,
      rows: 0,
      angleX: 0,
      angleY: 0,
      angleZ: 0,
      zoom: 1,
      light: [0.4, 0.6, -1] as Vec3,
      charset: "",
      charsetB: undefined as string | undefined,
      charsetMix: 0,
      samplesU: 160,
      samplesV: 160,
      aspect: 1,
      time: 0,
      dt: 0,
      projection: "perspective" as "perspective" | "ortho",
      fov: 2.4,
      camDist: 5,
      ambient: 0.12,
      diffuse: 0.88,
      specular: 0,
      shininess: 24,
      pointSize: 1,
      jitter: 0,
      persistence: 0,
      fog: 0,
    } as RenderOptions;

    // viewport size — ResizeObserver instead of a per-frame clientWidth/Height
    // read (a potential forced layout, worst while the side panel is being
    // drag-resized and every pointermove dirties layout). The observer fires
    // once on observe, so the in-loop fallback read runs at most until then.
    let wrapW = 0,
      wrapH = 0,
      roSeen = false;
    const ro = new ResizeObserver(() => {
      wrapW = wrap.clientWidth;
      wrapH = wrap.clientHeight;
      roSeen = true;
    });
    ro.observe(wrap);

    // zoom via wheel — native listener so preventDefault works (React attaches
    // passively); commits are coalesced to one per frame via pendingZoom
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const base = pendingZoom.current ?? settingsRef.current.zoom;
      pendingZoom.current = clampZoom(base * (e.deltaY > 0 ? 0.92 : 1.08));
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });

    // shader mouse uniform — hover position over the canvas, 0..1 (y down),
    // plus the pressed state for interactive shapes. A plain mutable object:
    // the listeners write it, the render loop reads it; never React state
    // (pointermove must not re-render the app).
    const mouseN = { x: 0.5, y: 0.5, down: false };
    const onPointerLocal = (e: PointerEvent) => {
      mouseN.x = Math.min(1, Math.max(0, e.offsetX / Math.max(1, wrapW)));
      mouseN.y = Math.min(1, Math.max(0, e.offsetY / Math.max(1, wrapH)));
    };
    const onPointerDownLocal = (e: PointerEvent) => {
      onPointerLocal(e);
      mouseN.down = true;
    };
    const onPointerUpLocal = () => {
      mouseN.down = false;
    };
    canvas.addEventListener("pointermove", onPointerLocal);
    canvas.addEventListener("pointerdown", onPointerDownLocal);
    canvas.addEventListener("pointerup", onPointerUpLocal);
    canvas.addEventListener("pointercancel", onPointerUpLocal);
    canvas.addEventListener("pointerleave", onPointerUpLocal);

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = settingsRef.current;
      const r = renderableRef.current;

      // flush the coalesced zoom target: re-request until React has committed
      // it (settingsRef lags the setState by a frame at most), then drop it
      const pz = pendingZoom.current;
      if (pz !== null) {
        if (pz === s.zoom) pendingZoom.current = null;
        else onZoomRef.current(pz);
      }

      // charset crossfade: dither from the previous ramp into the new one
      if (s.charset !== prevCharset.current) {
        charsetFade.current =
          !reducedMotion && prevCharset.current.length > 0
            ? { from: prevCharset.current, start: now }
            : null;
        prevCharset.current = s.charset;
      }
      let charsetB: string | undefined;
      let charsetMix = 0;
      if (charsetFade.current) {
        charsetMix = Math.min(1, (now - charsetFade.current.start) / FADE_MS);
        if (charsetMix >= 1) charsetFade.current = null;
        else charsetB = charsetFade.current.from;
      }

      // theme crossfade: lerp the palette + background when the color mode matches
      // (rainbow/plasma palettes aren't theme gradients, so they just snap)
      if (s.theme !== prevTheme.current) {
        themeFade.current =
          !reducedMotion && s.colorMode === "ramp" && s.theme.mode === prevTheme.current.mode
            ? { from: prevTheme.current, start: now }
            : null;
        prevTheme.current = s.theme;
      }
      const tf = themeFade.current;
      let themeMix = 0;
      if (tf) {
        themeMix = Math.min(1, (now - tf.start) / FADE_MS);
        if (themeMix >= 1) themeFade.current = null;
      }

      // shape-switch dissolve: capture the outgoing frame's luminance (still in
      // lumRef — renderFrame hasn't run yet) so it can ghost-decay out of the
      // incoming shape's first frames
      if (entryKeyRef.current !== prevEntryKey.current) {
        prevEntryKey.current = entryKeyRef.current;
        shapeFade.current =
          !reducedMotion && lumRef.current.length > 0 && lastCols > 0 && lastRows > 0
            ? { lum: Float32Array.from(lumRef.current), start: now, cols: lastCols, rows: lastRows }
            : null;
      }

      // sizing — compare rounded ints: canvas.width truncates, so a fractional
      // W*dpr (125%/150% display scaling) would never compare equal and would
      // reallocate + clear the backing store every frame
      const dpr = window.devicePixelRatio || 1;
      if (!roSeen) {
        wrapW = wrap.clientWidth;
        wrapH = wrap.clientHeight;
      }
      const W = wrapW,
        H = wrapH;
      const bw = Math.max(1, Math.round(W * dpr));
      const bh = Math.max(1, Math.round(H * dpr));
      let resized = false;
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        resized = true;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fs = s.fontSize;
      const fm = fontMetrics(fs);
      ctx.font = fm.font;
      const cw = fm.cw;
      const ch = fs * 1.15;
      const cols = Math.max(8, Math.floor(W / cw));
      const rows = Math.max(4, Math.floor(H / ch));
      lastCols = cols;
      lastRows = rows;

      // surface time
      const simDt = s.paused ? 0 : dt * s.timeScale;
      if (simDt > 0) time.current += simDt;

      // rotation
      const a = angles.current;
      if (!drag.current && !pinch.current) {
        if (s.autoRotate) {
          a[0] += s.spin[0] * s.speed * dt;
          a[1] += s.spin[1] * s.speed * dt;
          a[2] += s.spin[2] * s.speed * dt;
        }
        // inertia
        a[1] += velocity.current[0] * dt;
        a[0] += velocity.current[1] * dt;
        const decay = Math.pow(0.05, dt);
        velocity.current[0] *= decay;
        velocity.current[1] *= decay;
      }

      // idle skip: static geometry (RenderResult.static — time-invariant) with an
      // unchanged view signature and nothing in motion produces an identical
      // frame, so skip the render+draw pipeline entirely. Any settings change,
      // rotation, drag, zoom, fade, resize or shape/param swap breaks one of the
      // guards and the next frame renders normally.
      const vel = velocity.current;
      const sig = viewSig(cols, rows, a, s);
      const idle =
        !resized &&
        lastStatic &&
        lastR === r &&
        s.persistence === 0 &&
        s.colorMode !== "plasma" && // the palette breathes every frame — never idle
        !drag.current &&
        !pinch.current &&
        Math.abs(vel[0]) < 1e-4 &&
        Math.abs(vel[1]) < 1e-4 &&
        !charsetFade.current &&
        !themeFade.current &&
        !shapeFade.current &&
        lastSig === sig;
      lastR = r;

      if (!idle) {
        ctx.fillStyle = tf ? lerpHex(tf.from.bg, s.theme.bg, themeMix) : s.theme.bg;
        ctx.fillRect(0, 0, W, H);
      }

      let engineMs = 0;
      if (r && !idle) {
        const su = s.samples;
        const sv = s.samplesV > 0 ? s.samplesV : s.samples;
        opt.cols = cols;
        opt.rows = rows;
        opt.angleX = a[0];
        opt.angleY = a[1];
        opt.angleZ = a[2];
        opt.zoom = s.zoom;
        opt.light = s.light;
        opt.charset = s.charset;
        opt.charsetB = charsetB;
        opt.charsetMix = charsetMix;
        opt.samplesU = su;
        opt.samplesV = sv;
        opt.aspect = ch / cw;
        opt.time = time.current;
        opt.dt = simDt;
        opt.projection = s.projection;
        opt.fov = s.fov;
        opt.camDist = s.camDist;
        opt.ambient = s.ambient;
        opt.diffuse = s.diffuse;
        opt.specular = s.specular;
        opt.shininess = s.shininess;
        opt.pointSize = s.pointSize;
        opt.jitter = s.jitter;
        opt.persistence = s.persistence;
        opt.fog = s.fog;
        opt.mouse = mouseN;
        let res: ReturnType<typeof renderFrame> | null;
        const t0 = performance.now();
        try {
          res = renderFrame(r, opt);
          engineMs = performance.now() - t0;
          points = res.points;

          // dissolve: the outgoing shape's luminance decays out of the new frame
          const sf = shapeFade.current;
          if (sf) {
            const mix = Math.min(1, (now - sf.start) / FADE_MS);
            if (mix >= 1 || sf.cols !== cols || sf.rows !== rows) {
              shapeFade.current = null;
            } else {
              if (blendBuf.length !== res.lum.length) blendBuf = new Float32Array(res.lum.length);
              const blended = blendBuf;
              const keep = 1 - mix;
              for (let i = 0; i < blended.length; i++) {
                const cur = res.lum[i];
                const g = sf.lum[i] * keep;
                if (cur < 0 && g <= 0)
                  blended[i] = -1; // keep true emptiness empty
                else blended[i] = Math.min(1, (cur < 0 ? 0 : cur) + g);
              }
              res.lum = blended;
              res.chars = charsFromLum(blended, cols, rows, s.charset, charsetB, charsetMix);
            }
          }

          frameRef.current = res.chars;
          lumRef.current = res.lum;

          // surfaces/shapes that fail at runtime: report onset and recovery (throttled)
          const ratio = res.thrown / Math.max(1, su * sv);
          if (ratio > 0.02 && now - lastErrReport > 1000) {
            onError(
              res.firstError
                ? `render error: ${res.firstError}`
                : "evaluation failed on part of the grid",
            );
            lastErrReport = now;
            errActive = true;
          } else if (errActive && ratio <= 0.02) {
            onError(null);
            errActive = false;
          }
        } catch (e) {
          // never let one bad frame kill the loop
          res = null;
          lastStatic = false;
          frameRef.current = [];
          lumRef.current = new Float32Array(0);
          if (now - lastErrReport > 1000) {
            onError(`render error: ${(e as Error)?.message ?? String(e)}`);
            lastErrReport = now;
            errActive = true;
          }
        }

        if (res) {
          lastStatic = res.static === true;
          lastSig = sig;
          const ox = (W - cols * cw) / 2;
          const oy = (H - rows * ch) / 2;
          ctx.textBaseline = "top";
          const t1 = performance.now();

          // rainbow/plasma map luminance to color too — they use the run-length
          // colored path even on mono themes; mono+flat stays the fast row path
          if (s.theme.mode === "mono" && s.colorMode === "ramp") {
            ctx.fillStyle = tf ? lerpHex(tf.from.fg, s.theme.fg, themeMix) : s.theme.fg;
            for (let row = 0; row < rows; row++) {
              const line = res.chars[row];
              if (!line || !hasInk(line)) continue;
              // one fillText per row: a monospace font advances every glyph (spaces
              // included) by exactly cw, so this lays out identically to per-char draws
              ctx.fillText(line, ox, oy + row * ch);
            }
          } else {
            const pk = s.theme.bg + s.theme.fg + s.theme.glow;
            if (s.colorMode === "plasma") {
              // animated palette — rebuilt per frame from the theme's hue
              palette = buildPlasmaRgb(s.theme.fg, now / 1000).map(
                ([r, g, b]) => `rgb(${r},${g},${b})`,
              );
              paletteKey = "";
            } else if (s.colorMode === "rainbow") {
              if (paletteKey !== "rainbow") {
                palette = buildRainbowRgb().map(([r, g, b]) => `rgb(${r},${g},${b})`);
                paletteKey = "rainbow";
              }
            } else if (tf) {
              // mid-fade: blend the two numeric ramps (32 entries — cheap per frame)
              const fromR = buildRampRgb(tf.from.bg, tf.from.fg, tf.from.glow);
              const toR = buildRampRgb(s.theme.bg, s.theme.fg, s.theme.glow);
              palette = fromR.map((a, i) => {
                const b = toR[i];
                return `rgb(${Math.round(a[0] + (b[0] - a[0]) * themeMix)},${Math.round(a[1] + (b[1] - a[1]) * themeMix)},${Math.round(a[2] + (b[2] - a[2]) * themeMix)})`;
              });
              paletteKey = "";
            } else if (pk !== paletteKey) {
              palette = buildPalette(s.theme.bg, s.theme.fg, s.theme.glow);
              paletteKey = pk;
            }
            ctx.shadowColor = tf ? lerpHex(tf.from.glow, s.theme.glow, themeMix) : s.theme.glow;
            const maxIdx = PAL_STEPS - 1;
            for (let row = 0; row < rows; row++) {
              const line = res.chars[row];
              if (!line) continue;
              const base = row * cols;
              // run-length batching: one fillStyle + fillText per same-color run
              // instead of per cell — the dominant cost in heat mode
              let c = 0;
              while (c < cols) {
                if (line[c] === " ") {
                  c++;
                  continue;
                }
                const li = res.lum[base + c];
                const idx = Math.max(0, Math.min(maxIdx, Math.round(li * maxIdx)));
                let end = c + 1;
                while (end < cols && line[end] !== " ") {
                  const lj = res.lum[base + end];
                  const jdx = Math.max(0, Math.min(maxIdx, Math.round(lj * maxIdx)));
                  if (jdx !== idx) break;
                  end++;
                }
                ctx.fillStyle = palette[idx];
                ctx.fillText(
                  c + 1 === end ? line[c] : line.slice(c, end),
                  ox + c * cw,
                  oy + row * ch,
                );
                c = end;
              }
            }
          }
          ctx.shadowColor = "transparent";
          engineAvg = engineAvg * 0.9 + engineMs * 0.1;
          drawAvg = drawAvg * 0.9 + (performance.now() - t1) * 0.1;
          msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1;
        }
      } else if (!r) {
        // compile error: drop the last good frame so copy/txt export can't serve it
        frameRef.current = [];
        lumRef.current = new Float32Array(0);
        lastStatic = false;
      }

      fpsAcc += dt;
      fpsN++;
      if (now - lastStat > 250) {
        // while idle no engine/draw work happens — report zeros so the debug
        // readout reflects that instead of a stale smoothed value
        onStats({
          fps: fpsN / (fpsAcc || 1),
          ms: idle ? 0 : msAvg,
          engineMs: idle ? 0 : engineAvg,
          drawMs: idle ? 0 : drawAvg,
          points,
          cols,
          rows,
          angles: [a[0], a[1], a[2]],
          time: time.current,
        });
        fpsAcc = 0;
        fpsN = 0;
        lastStat = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("wheel", onWheelNative);
      canvas.removeEventListener("pointermove", onPointerLocal);
      canvas.removeEventListener("pointerdown", onPointerDownLocal);
      canvas.removeEventListener("pointerup", onPointerUpLocal);
      canvas.removeEventListener("pointercancel", onPointerUpLocal);
      canvas.removeEventListener("pointerleave", onPointerUpLocal);
      reducedMotionQuery?.removeEventListener("change", onReducedMotion);
    };
  }, [onStats, onError, frameRef, lumRef, canvasRef]);
  // pointer interaction: 1 pointer = drag-rotate, 2 pointers = pinch-zoom
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
        zoom: settingsRef.current.zoom,
      };
      drag.current = null;
      velocity.current = [0, 0];
    } else if (pointers.current.size === 1) {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      velocity.current = [0, 0];
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      // anchored on the gesture-start zoom; the rAF loop commits the latest value
      pendingZoom.current = clampZoom(pinch.current.zoom * (dist / pinch.current.dist));
      return;
    }
    const dg = drag.current;
    if (!dg || dg.id !== e.pointerId) return;
    const dx = e.clientX - dg.x;
    const dy = e.clientY - dg.y;
    const dtm = Math.min(100, Math.max(8, e.timeStamp - dg.t));
    dg.x = e.clientX;
    dg.y = e.clientY;
    dg.t = e.timeStamp;
    angles.current[1] += dx * 0.01;
    angles.current[0] += dy * 0.01;
    // flick velocity: rad/s smoothed over the last moves, clamped so tiny taps don't launch
    const ivx = Math.max(-10, Math.min(10, ((dx * 0.01) / dtm) * 1000));
    const ivy = Math.max(-10, Math.min(10, ((dy * 0.01) / dtm) * 1000));
    velocity.current = [
      velocity.current[0] * 0.6 + ivx * 0.4,
      velocity.current[1] * 0.6 + ivy * 0.4,
    ];
  };
  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current && (drag.current.id === e.pointerId || pointers.current.size === 0))
      drag.current = null;
    // if one finger remains after a pinch, resume dragging from it
    if (!pinch.current && !drag.current && pointers.current.size === 1) {
      const [id, p] = [...pointers.current.entries()][0];
      drag.current = { id, x: p.x, y: p.y, t: e.timeStamp };
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full min-w-0 cursor-grab select-none touch-none active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`ASCII 3D render of ${name}. Drag to rotate, scroll to zoom.`}
        className="block h-full w-full"
      />
    </div>
  );
}
