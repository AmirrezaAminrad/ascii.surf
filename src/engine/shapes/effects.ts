import { clamp, clamp01, fmtNum, makeNoise3, mulberry32 } from "../math";
import { planarCode, simCode, type Pointer, type Shape, type Sim } from "../types";

/**
 * Interactive full-viewport ASCII effects (clean-room equivalents of the React
 * Bits Pro set: AsciiRipple, LiquidAscii, AsciiWaves, AsciiTiles, AsciiCursor).
 * All of them read the viewport pointer, so they need the renderer's pointer
 * plumbing — sims get it as the 4th step() argument, native planar shapes as
 * the 7th planar() argument, editable sim code as `env.mouse`.
 */

const F = fmtNum;

const seedSpec = { key: "seed", label: "seed", min: 0, max: 9999, step: 1, def: 42, int: true };

/** Fallback for direct calls (tests); the renderer always passes a live pointer. */
const IDLE_POINTER: Pointer = { x: 0.5, y: 0.5, down: false };

// rasterization scratch for liquidAscii's planar output (reused across frames)
let densCache: { cols: number; rows: number; buf: Float32Array } | null = null;

// ---------------------------------------------------------------------------
// Ripple — interactive liquid surface on a wave-equation grid. Clicks
// drop, dragging stirs, optional rain; surface slope drives the luminance so
// crests bloom into heavier glyphs over a dim baseline field.
// ---------------------------------------------------------------------------

const RW = 168;
const RH = 96;

export const asciiRipple: Shape = {
  id: "ascii-ripple",
  name: "Ripple",
  category: "Simulations",
  description:
    "Interactive liquid surface: click to drop, drag to stir, rain for ambiance — waves bend the glyph field into bright crests and dim troughs.",
  animated: true,
  params: [
    { key: "speed", label: "wave speed", min: 0.1, max: 2.5, step: 0.05, def: 0.55 },
    { key: "damping", label: "damping", min: 0, max: 0.3, step: 0.005, def: 0.012 },
    { key: "viscosity", label: "viscosity", min: 0, max: 1, step: 0.05, def: 0.25 },
    { key: "dropStrength", label: "drop strength", min: 0, max: 3, step: 0.05, def: 1.2 },
    { key: "dropRadius", label: "drop radius", min: 2, max: 12, step: 0.5, def: 4 },
    { key: "dragStrength", label: "drag strength", min: 0, max: 1.5, step: 0.05, def: 0.5 },
    { key: "dragRadius", label: "drag radius", min: 1, max: 8, step: 0.5, def: 2.5 },
    { key: "rain", label: "rain drops/s", min: 0, max: 8, step: 0.25, def: 0 },
    { key: "slopeGain", label: "slope gain", min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: "rest", label: "baseline glow", min: 0, max: 0.4, step: 0.01, def: 0.15 },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const n = RW * RH;
    let h = new Float32Array(n);
    const v = new Float32Array(n);
    let h2 = new Float32Array(n);
    const rng = mulberry32(seed);
    let rainAcc = 0;
    let px = 0.5;
    let py = 0.5;
    let wasDown = false;
    let seen = false;

    const drop = (cx: number, cy: number, r: number, amp: number) => {
      const r2 = r * r * 0.5;
      const x0 = Math.max(1, Math.floor(cx - r * 1.8));
      const x1 = Math.min(RW - 2, Math.ceil(cx + r * 1.8));
      const y0 = Math.max(1, Math.floor(cy - r * 1.8));
      const y1 = Math.min(RH - 2, Math.ceil(cy + r * 1.8));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          v[y * RW + x] -= amp * Math.exp(-(dx * dx + dy * dy) / r2);
        }
      }
    };

    const substep = (k: number, damp: number) => {
      for (let y = 1; y < RH - 1; y++) {
        const row = y * RW;
        for (let x = 1; x < RW - 1; x++) {
          const i = row + x;
          const avg = (h[i - 1] + h[i + 1] + h[i - RW] + h[i + RW]) * 0.25;
          v[i] = (v[i] + (avg - h[i]) * k) * damp;
        }
      }
      // absorbing edges: drain energy into the border ring
      for (let x = 0; x < RW; x++) {
        v[x] *= 0.5;
        v[(RH - 1) * RW + x] *= 0.5;
      }
      for (let y = 0; y < RH; y++) {
        v[y * RW] *= 0.5;
        v[y * RW + RW - 1] *= 0.5;
      }
      for (let i = 0; i < n; i++) h[i] += v[i];
      if (visc > 0) {
        for (let y = 1; y < RH - 1; y++) {
          const row = y * RW;
          for (let x = 1; x < RW - 1; x++) {
            const i = row + x;
            const avg = (h[i - 1] + h[i + 1] + h[i - RW] + h[i + RW]) * 0.25;
            h2[i] = h[i] + (avg - h[i]) * visc;
          }
        }
        for (let x = 0; x < RW; x++) {
          h2[x] = h[x];
          h2[(RH - 1) * RW + x] = h[(RH - 1) * RW + x];
        }
        for (let y = 0; y < RH; y++) {
          h2[y * RW] = h[y * RW];
          h2[y * RW + RW - 1] = h[y * RW + RW - 1];
        }
        const tmp = h;
        h = h2;
        h2 = tmp;
      }
    };

    const visc = clamp01(p.viscosity) * 0.3;
    const k = Math.min(0.45, 0.24 * p.speed * p.speed);
    const damp = 1 - clamp(p.damping, 0, 0.5);

    return {
      step(dt, _time, _out, pointer) {
        const P = pointer ?? IDLE_POINTER;
        if (!seen) {
          px = P.x;
          py = P.y;
          wasDown = P.down;
          seen = true;
          if (dt <= 0) return;
        }
        if (dt <= 0) {
          px = P.x;
          py = P.y;
          wasDown = P.down;
          return;
        }
        const sx = P.x * RW;
        const sy = P.y * RH;
        const psx = px * RW;
        const psy = py * RH;
        if (P.down && !wasDown) drop(sx, sy, p.dropRadius, p.dropStrength * 0.6);
        if (Math.abs(P.x - px) + Math.abs(P.y - py) > 1e-4) {
          const d = Math.hypot(sx - psx, sy - psy);
          const amp = p.dragStrength * (P.down ? 0.1 : 0.05);
          const steps = Math.min(24, Math.max(1, Math.ceil(d / 1.2)));
          for (let s = 1; s <= steps; s++) {
            const f = s / steps;
            drop(psx + (sx - psx) * f, psy + (sy - psy) * f, p.dragRadius, amp);
          }
        }
        rainAcc += dt * p.rain;
        while (rainAcc >= 1) {
          rainAcc -= 1;
          drop(
            2 + rng() * (RW - 4),
            2 + rng() * (RH - 4),
            p.dropRadius * 0.8,
            p.dropStrength * 0.36,
          );
        }
        substep(k, damp);
        substep(k, damp);
        px = P.x;
        py = P.y;
        wasDown = P.down;
      },
      planar(cols, rows, _aspect, out) {
        const gain = p.slopeGain * 12;
        const rest = clamp01(p.rest);
        for (let row = 0; row < rows; row++) {
          const gy = clamp(Math.floor((row / rows) * RH), 0, RH - 1);
          const rowOff = gy * RW;
          for (let col = 0; col < cols; col++) {
            const gx = clamp(Math.floor((col / cols) * RW), 0, RW - 1);
            const i = rowOff + gx;
            const c = h[i];
            const avg =
              ((gx > 0 ? h[i - 1] : c) +
                (gx < RW - 1 ? h[i + 1] : c) +
                (gy > 0 ? h[i - RW] : c) +
                (gy < RH - 1 ? h[i + RW] : c)) *
              0.25;
            const lum = clamp01(rest + (c - avg) * gain);
            // troughs stay as dim dots instead of blanking out
            out[row * cols + col] = lum <= 0 ? 0.02 : lum;
          }
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// interactive liquid surface — click to drop, drag to stir
// env.mouse: live pointer { x, y in 0..1 (y down), down }
const RW = ${RW}, RH = ${RH};
const k = ${F(Math.min(0.45, 0.24 * p.speed * p.speed))}, damp = 1 - ${F(clamp(p.damping, 0, 0.5))}, visc = ${F(clamp01(p.viscosity) * 0.3)};
const dropR = ${F(p.dropRadius)}, dropA = ${F(p.dropStrength * 0.6)};
const dragR = ${F(p.dragRadius)}, dragHover = ${F(p.dragStrength * 0.05)}, dragPress = ${F(p.dragStrength * 0.1)};
const gain = ${F(p.slopeGain * 12)}, rest = ${F(clamp01(p.rest))}, rain = ${F(p.rain)};
let rndState = ${Math.round(p.seed)} >>> 0;
const rnd = () => {
  rndState = (rndState + 0x6d2b79f5) | 0;
  let s = Math.imul(rndState ^ (rndState >>> 15), 1 | rndState);
  s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
};
let h = new Float32Array(RW * RH), v = new Float32Array(RW * RH), h2 = new Float32Array(RW * RH);
let rainAcc = 0, px = 0.5, py = 0.5, wasDown = false, seen = false;
const drop = (cx, cy, r, amp) => {
  const r2 = r * r * 0.5;
  const x0 = max(1, floor(cx - r * 1.8)), x1 = min(RW - 2, ceil(cx + r * 1.8));
  const y0 = max(1, floor(cy - r * 1.8)), y1 = min(RH - 2, ceil(cy + r * 1.8));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      v[y * RW + x] -= amp * exp(-(dx * dx + dy * dy) / r2);
    }
};
const substep = () => {
  for (let y = 1; y < RH - 1; y++)
    for (let x = 1; x < RW - 1; x++) {
      const i = y * RW + x;
      const avg = (h[i - 1] + h[i + 1] + h[i - RW] + h[i + RW]) * 0.25;
      v[i] = (v[i] + (avg - h[i]) * k) * damp;
    }
  for (let x = 0; x < RW; x++) { v[x] *= 0.5; v[(RH - 1) * RW + x] *= 0.5; }
  for (let y = 0; y < RH; y++) { v[y * RW] *= 0.5; v[y * RW + RW - 1] *= 0.5; }
  for (let i = 0, n = RW * RH; i < n; i++) h[i] += v[i];
  if (visc > 0) {
    for (let y = 1; y < RH - 1; y++)
      for (let x = 1; x < RW - 1; x++) {
        const i = y * RW + x;
        const avg = (h[i - 1] + h[i + 1] + h[i - RW] + h[i + RW]) * 0.25;
        h2[i] = h[i] + (avg - h[i]) * visc;
      }
    for (let x = 0; x < RW; x++) { h2[x] = h[x]; h2[(RH - 1) * RW + x] = h[(RH - 1) * RW + x]; }
    for (let y = 0; y < RH; y++) { h2[y * RW] = h[y * RW]; h2[y * RW + RW - 1] = h[y * RW + RW - 1]; }
    const tmp = h; h = h2; h2 = tmp;
  }
};
return {
  step(dt) {
    const M = env.mouse;
    if (!seen) { px = M.x; py = M.y; wasDown = M.down; seen = true; if (dt <= 0) return; }
    if (dt <= 0) { px = M.x; py = M.y; wasDown = M.down; return; }
    const sx = M.x * RW, sy = M.y * RH, psx = px * RW, psy = py * RH;
    if (M.down && !wasDown) drop(sx, sy, dropR, dropA);
    if (abs(M.x - px) + abs(M.y - py) > 1e-4) {
      const d = hypot(sx - psx, sy - psy);
      const steps = min(24, max(1, ceil(d / 1.2)));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        drop(psx + (sx - psx) * f, psy + (sy - psy) * f, dragR, M.down ? dragPress : dragHover);
      }
    }
    rainAcc += dt * rain;
    while (rainAcc >= 1) {
      rainAcc -= 1;
      drop(2 + rnd() * (RW - 4), 2 + rnd() * (RH - 4), dropR * 0.8, dropA * 0.6);
    }
    substep();
    substep();
    px = M.x; py = M.y; wasDown = M.down;
  },
  planar(cols, rows, aspect, out) {
    for (let row = 0; row < rows; row++) {
      const gy = max(0, min(RH - 1, floor((row / rows) * RH)));
      for (let col = 0; col < cols; col++) {
        const gx = max(0, min(RW - 1, floor((col / cols) * RW)));
        const i = gy * RW + gx;
        const c = h[i];
        const avg = ((gx > 0 ? h[i - 1] : c) + (gx < RW - 1 ? h[i + 1] : c) +
          (gy > 0 ? h[i - RW] : c) + (gy < RH - 1 ? h[i + RW] : c)) * 0.25;
        out[row * cols + col] = min(1, max(0, rest + (c - avg) * gain)) || 0.02;
      }
    }
  },
};`,
      "Ripple",
    ),
};

// ---------------------------------------------------------------------------
// Liquid — a MAC-grid FLIP fluid (staggered u/v faces, Gauss-Seidel pressure
// projection with over-relaxation, FLIP/PIC velocity blend): gravity sloshes
// it, the cursor grabs and throws it, idle waves roll the surface.
// ---------------------------------------------------------------------------

export const liquidAscii: Shape = {
  id: "liquid-ascii",
  name: "Liquid",
  category: "Simulations",
  description:
    "A tank of FLIP-simulated water rendered as glyphs — grab it, throw it, splash it; rolling waves keep the surface alive while you're away.",
  animated: true,
  params: [
    { key: "speed", label: "speed", min: 0.1, max: 3, step: 0.05, def: 0.9 },
    { key: "resolution", label: "grid cells", min: 64, max: 128, step: 8, def: 96, int: true },
    { key: "gravity", label: "gravity", min: -50, max: 0, step: 1, def: -25 },
    { key: "flipRatio", label: "FLIP blend", min: 0, max: 1, step: 0.05, def: 0.3 },
    { key: "pressureIters", label: "pressure iters", min: 5, max: 80, step: 1, def: 30, int: true },
    {
      key: "separationIters",
      label: "separation iters",
      min: 1,
      max: 10,
      step: 1,
      def: 3,
      int: true,
    },
    { key: "overRelaxation", label: "over-relaxation", min: 1, max: 2, step: 0.05, def: 1.5 },
    { key: "fillHeight", label: "fill height", min: 0.05, max: 0.95, step: 0.05, def: 0.4 },
    { key: "cursorRadius", label: "cursor radius", min: 0.02, max: 0.5, step: 0.01, def: 0.25 },
    { key: "cursorForce", label: "cursor force", min: 0, max: 200, step: 2, def: 66 },
    { key: "autoWave", label: "idle waves", min: 0, max: 2, step: 0.1, def: 0.8 },
  ],
  sim: (p): Sim => {
    const GW = clamp(Math.round(p.resolution / 8) * 8, 64, 128);
    const GH = Math.round(GW * 0.5625);
    const h = 1 / GW;
    const H = GH * h; // tank height (width is 1)
    const nU = (GW + 1) * GH;
    const nV = GW * (GH + 1);
    const u = new Float32Array(nU); // x-face velocities
    const v = new Float32Array(nV); // y-face velocities
    const up = new Float32Array(nU); // pre-projection snapshot (FLIP delta)
    const vp = new Float32Array(nV);
    const uw = new Float32Array(nU);
    const vw = new Float32Array(nV);
    const maxN = GW * GH;
    const pX = new Float32Array(maxN);
    const pY = new Float32Array(maxN);
    const vX = new Float32Array(maxN);
    const vY = new Float32Array(maxN);
    const rng = mulberry32(20260925);
    const fill = clamp(p.fillHeight, 0.05, 0.95);
    const rows = Math.max(1, Math.round(fill * GH));
    let N = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < GW; i++) {
        pX[N] = (i + 0.5 + (rng() - 0.5) * 0.4) * h;
        pY[N] = (j + 0.5 + (rng() - 0.5) * 0.4) * h;
        N++;
      }
    }
    const minDist = 1.1 * h;
    const numCell = new Int32Array(GW * GH);
    const firstCell = new Int32Array(GW * GH + 1);
    const cursorCell = new Int32Array(GW * GH);
    const cellIds = new Int32Array(maxN);
    const sFl = new Uint8Array(GW * GH); // fluid mask: cells holding particles

    // Müller-style particle separation: counting-sort grid + 3×3 neighborhood
    const pushApart = (iters: number) => {
      const n = GW * GH;
      const md2 = minDist * minDist;
      for (let it = 0; it < iters; it++) {
        numCell.fill(0);
        for (let i = 0; i < N; i++) {
          const c =
            clamp(Math.floor(pY[i] / h), 0, GH - 1) * GW + clamp(Math.floor(pX[i] / h), 0, GW - 1);
          numCell[c]++;
        }
        let first = 0;
        for (let c = 0; c < n; c++) {
          firstCell[c] = first;
          first += numCell[c];
        }
        firstCell[n] = first;
        cursorCell.set(firstCell.subarray(0, n));
        for (let i = 0; i < N; i++) {
          const c =
            clamp(Math.floor(pY[i] / h), 0, GH - 1) * GW + clamp(Math.floor(pX[i] / h), 0, GW - 1);
          cellIds[cursorCell[c]++] = i;
        }
        for (let i = 0; i < N; i++) {
          const xi = clamp(Math.floor(pX[i] / h), 0, GW - 1);
          const yi = clamp(Math.floor(pY[i] / h), 0, GH - 1);
          const x0 = xi > 1 ? xi - 2 : 0;
          const x1 = xi < GW - 2 ? xi + 2 : GW - 1;
          const y0 = yi > 1 ? yi - 2 : 0;
          const y1 = yi < GH - 2 ? yi + 2 : GH - 1;
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              const c = yy * GW + xx;
              for (let k = firstCell[c]; k < firstCell[c + 1]; k++) {
                const j = cellIds[k];
                if (j === i) continue;
                const dx = pX[j] - pX[i];
                const dy = pY[j] - pY[i];
                const d2 = dx * dx + dy * dy;
                if (d2 >= md2 || d2 < 1e-12) continue;
                const d = Math.sqrt(d2);
                const s = (0.7 * (minDist - d)) / d;
                const ox = dx * s;
                const oy = dy * s;
                pX[i] -= ox;
                pY[i] -= oy;
                pX[j] += ox;
                pY[j] += oy;
                // damp the pair's closing velocity — otherwise gravity re-squeezes
                // the pool every frame and it settles as a thin floor layer
                const vn = ((vX[j] - vX[i]) * dx + (vY[j] - vY[i]) * dy) / d;
                if (vn < 0) {
                  const ex = (dx / d) * vn * 0.45;
                  const ey = (dy / d) * vn * 0.45;
                  vX[i] += ex;
                  vY[i] += ey;
                  vX[j] -= ex;
                  vY[j] -= ey;
                }
              }
            }
          }
        }
      }
    };

    // particles → staggered grid: bilinear splat of u (x-faces) and v (y-faces)
    const transferToGrid = () => {
      u.fill(0);
      uw.fill(0);
      v.fill(0);
      vw.fill(0);
      for (let i = 0; i < N; i++) {
        const x = clamp(pX[i], 0, 1 - 1e-6);
        const y = clamp(pY[i], 0, H - 1e-6);
        // u faces live at (fi·h, (fj+0.5)·h)
        let a = x / h;
        let fi = clamp(Math.floor(a), 0, GW - 1);
        let tx = clamp(a - fi, 0, 1);
        let b = y / h - 0.5;
        let fj = clamp(Math.floor(b), 0, GH - 2);
        let ty = clamp(b - fj, 0, 1);
        let row = fj * (GW + 1) + fi;
        let w = (1 - tx) * (1 - ty);
        u[row] += vX[i] * w;
        uw[row] += w;
        w = tx * (1 - ty);
        u[row + 1] += vX[i] * w;
        uw[row + 1] += w;
        w = (1 - tx) * ty;
        u[row + GW + 1] += vX[i] * w;
        uw[row + GW + 1] += w;
        w = tx * ty;
        u[row + GW + 2] += vX[i] * w;
        uw[row + GW + 2] += w;
        // v faces live at ((fi+0.5)·h, fj·h)
        a = x / h - 0.5;
        fi = clamp(Math.floor(a), 0, GW - 2);
        tx = clamp(a - fi, 0, 1);
        b = y / h;
        fj = clamp(Math.floor(b), 0, GH - 1);
        ty = clamp(b - fj, 0, 1);
        row = fj * GW + fi;
        w = (1 - tx) * (1 - ty);
        v[row] += vY[i] * w;
        vw[row] += w;
        w = tx * (1 - ty);
        v[row + 1] += vY[i] * w;
        vw[row + 1] += w;
        w = (1 - tx) * ty;
        v[row + GW] += vY[i] * w;
        vw[row + GW] += w;
        w = tx * ty;
        v[row + GW + 1] += vY[i] * w;
        vw[row + GW + 1] += w;
      }
      for (let k = 0; k < nU; k++) if (uw[k] > 1e-6) u[k] /= uw[k];
      for (let k = 0; k < nV; k++) if (vw[k] > 1e-6) v[k] /= vw[k];
      // walls: no flow through the tank boundary
      for (let j = 0; j < GH; j++) {
        u[j * (GW + 1)] = 0;
        u[j * (GW + 1) + GW] = 0;
      }
      for (let i = 0; i < GW; i++) {
        v[i] = 0;
        v[GH * GW + i] = 0;
      }
    };

    const sampleU = (arr: Float32Array, x: number, y: number): number => {
      const a = x / h;
      const fi = clamp(Math.floor(a), 0, GW - 1);
      const tx = clamp(a - fi, 0, 1);
      const b = y / h - 0.5;
      const fj = clamp(Math.floor(b), 0, GH - 2);
      const ty = clamp(b - fj, 0, 1);
      const row = fj * (GW + 1) + fi;
      return (
        arr[row] * (1 - tx) * (1 - ty) +
        arr[row + 1] * tx * (1 - ty) +
        arr[row + GW + 1] * (1 - tx) * ty +
        arr[row + GW + 2] * tx * ty
      );
    };

    const sampleV = (arr: Float32Array, x: number, y: number): number => {
      const a = x / h - 0.5;
      const fi = clamp(Math.floor(a), 0, GW - 2);
      const tx = clamp(a - fi, 0, 1);
      const b = y / h;
      const fj = clamp(Math.floor(b), 0, GH - 1);
      const ty = clamp(b - fj, 0, 1);
      const row = fj * GW + fi;
      return (
        arr[row] * (1 - tx) * (1 - ty) +
        arr[row + 1] * tx * (1 - ty) +
        arr[row + GW] * (1 - tx) * ty +
        arr[row + GW + 1] * tx * ty
      );
    };

    // Gauss-Seidel divergence relaxation with over-relaxation, solved only in
    // cells that hold water. Faces on the water–air boundary stay free so the
    // surface can rise and fall — solving the whole grid as one closed box
    // would pin the surface flat and forbid waves.
    const project = (iters: number) => {
      const relax = clamp(p.overRelaxation, 1, 2);
      for (let it = 0; it < iters; it++) {
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const c = j * GW + i;
            if (!sFl[c]) continue;
            const uL = j * (GW + 1) + i;
            const vB = j * GW + i;
            const div = (u[uL + 1] - u[uL] + v[vB + GW] - v[vB]) / h;
            const rOK = i < GW - 1 && sFl[c + 1];
            const lOK = i > 0 && sFl[c - 1];
            const tOK = j < GH - 1 && sFl[c + GW];
            const bOK = j > 0 && sFl[c - GW];
            const sSum = (rOK ? 1 : 0) + (lOK ? 1 : 0) + (tOK ? 1 : 0) + (bOK ? 1 : 0);
            if (sSum === 0) continue;
            const d = (div * h * relax) / sSum;
            if (rOK) u[uL + 1] -= d;
            if (lOK) u[uL] += d;
            if (tOK) v[vB + GW] -= d;
            if (bOK) v[vB] += d;
          }
        }
      }
    };

    let idle = 0;
    let opx = 0.5;
    let opy = 0.5;
    let ocx = 0.5;
    let ocy = 0;
    let seen = false;

    return {
      step(dt, time, _out, pointer) {
        const P = pointer ?? IDLE_POINTER;
        const cx = clamp(P.x, 0, 1);
        const cy = (1 - clamp(P.y, 0, 1)) * H; // tank y is up
        if (!seen) {
          opx = P.x;
          opy = P.y;
          ocx = cx;
          ocy = cy;
          seen = true;
        }
        if (dt <= 0) {
          opx = P.x;
          opy = P.y;
          ocx = cx;
          ocy = cy;
          return;
        }
        const dtc = Math.min(dt, 1 / 30) * clamp(p.speed, 0.05, 3);
        const moved = Math.abs(P.x - opx) + Math.abs(P.y - opy) > 1e-4;
        idle = moved || P.down ? 0 : idle + dt;

        pushApart(clamp(Math.round(p.separationIters), 1, 10));
        transferToGrid();

        // gravity across the whole v-grid (empty regions included, so airborne
        // droplets keep falling through the PIC blend)
        const g = p.gravity * 0.04;
        for (let j = 1; j < GH; j++) {
          const rowV = j * GW;
          for (let i = 0; i < GW; i++) v[rowV + i] += g * dtc;
        }

        // mark the water cells for the free-surface pressure solve
        sFl.fill(0);
        for (let i = 0; i < N; i++) {
          sFl[
            clamp(Math.floor(pY[i] / h), 0, GH - 1) * GW + clamp(Math.floor(pX[i] / h), 0, GW - 1)
          ] = 1;
        }

        up.set(u);
        vp.set(v);
        project(clamp(Math.round(p.pressureIters), 5, 80));

        // FLIP/PIC blend back: FLIP keeps the particle's momentum plus the
        // projection delta, PIC follows the smooth grid field
        const flip = clamp01(p.flipRatio);
        for (let i = 0; i < N; i++) {
          const x = clamp(pX[i], 0, 1 - 1e-6);
          const y = clamp(pY[i], 0, H - 1e-6);
          const gu = sampleU(u, x, y);
          const gv = sampleV(v, x, y);
          vX[i] = flip * (vX[i] + gu - sampleU(up, x, y)) + (1 - flip) * gu;
          vY[i] = flip * (vY[i] + gv - sampleV(vp, x, y)) + (1 - flip) * gv;
        }

        // cursor: radial push plus motion injection — hover stirs, press grabs
        const R = Math.max(0.02, p.cursorRadius) * H;
        const force = p.cursorForce * 0.05;
        const active = moved || P.down;
        const cvx = active ? clamp((cx - ocx) / Math.max(dtc, 1e-4), -3, 3) : 0;
        const cvy = active ? clamp((cy - ocy) / Math.max(dtc, 1e-4), -3, 3) : 0;
        if (active) {
          const grab = P.down ? 0.85 : 0.3;
          const R2 = R * R;
          for (let i = 0; i < N; i++) {
            const dx = pX[i] - cx;
            const dy = pY[i] - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;
            const d = Math.sqrt(d2);
            const f = 1 - d / R;
            const inv = 1 / Math.max(d, 0.015);
            vX[i] += dx * inv * force * dtc * f * 2 + cvx * f * grab;
            vY[i] += dy * inv * force * dtc * f * 2 + cvy * f * grab;
          }
        }

        // idle wave paddle at the left wall
        if (idle > 0.8 && p.autoWave > 0) {
          const amp = clamp01(p.autoWave) * Math.min(1, (idle - 0.8) * 2);
          const ph = Math.sin(time * 3);
          for (let i = 0; i < N; i++) {
            if (pX[i] < 0.15) vX[i] += ph * amp * 6 * dtc * (1 - pX[i] / 0.15);
          }
        }

        // integrate + walls (normal velocity killed on contact)
        const r = 0.5 * h;
        for (let i = 0; i < N; i++) {
          pX[i] += vX[i] * dtc;
          pY[i] += vY[i] * dtc;
          if (pX[i] < r) {
            pX[i] = r;
            if (vX[i] < 0) vX[i] = 0;
          } else if (pX[i] > 1 - r) {
            pX[i] = 1 - r;
            if (vX[i] > 0) vX[i] = 0;
          }
          if (pY[i] < r) {
            pY[i] = r;
            if (vY[i] < 0) vY[i] = 0;
          } else if (pY[i] > H - r) {
            pY[i] = H - r;
            if (vY[i] > 0) vY[i] = 0;
          }
        }
        opx = P.x;
        opy = P.y;
        ocx = cx;
        ocy = cy;
      },
      planar(cols, rows, _aspect, out) {
        if (!densCache || densCache.cols !== cols || densCache.rows !== rows) {
          densCache = { cols, rows, buf: new Float32Array(cols * rows) };
        }
        const dens = densCache.buf.fill(0);
        for (let i = 0; i < N; i++) {
          const c = Math.floor(pX[i] * cols);
          const r2 = Math.floor((1 - pY[i] / H) * rows);
          if (c < 0 || c >= cols || r2 < 0 || r2 >= rows) continue;
          const i2 = r2 * cols + c;
          dens[i2] += 1;
          if (c > 0) dens[i2 - 1] += 0.45;
          if (c < cols - 1) dens[i2 + 1] += 0.45;
          if (r2 > 0) dens[i2 - cols] += 0.45;
          if (r2 < rows - 1) dens[i2 + cols] += 0.45;
        }
        for (let i = 0, n = cols * rows; i < n; i++) {
          const d = dens[i];
          out[i] = d < 0.05 ? -1 : clamp01(1 - Math.exp(-d * 0.6));
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// MAC-grid FLIP water: particles → staggered grid → pressure projection
// → FLIP/PIC blend back. Grab the water with the cursor.
// env.mouse: live pointer { x, y in 0..1 (y down), down }
const GW = ${Math.round(p.resolution)}, GH = Math.round(GW * 0.5625), h = 1 / GW, H = GH * h;
const nU = (GW + 1) * GH, nV = GW * (GH + 1);
const g = ${F(p.gravity * 0.04)}, flip = ${F(clamp01(p.flipRatio))}, relax = ${F(p.overRelaxation)};
const iters = ${Math.round(p.pressureIters)}, sepIters = ${Math.round(p.separationIters)};
const R = ${F(Math.max(0.02, p.cursorRadius))} * H, force = ${F(p.cursorForce * 0.05)};
const fill = ${F(clamp(p.fillHeight, 0.05, 0.95))}, sp = ${F(clamp(p.speed, 0.05, 3))}, waveA = ${F(clamp01(p.autoWave))};
const ci = (v, a, b) => v < a ? a : v > b ? b : v;
const rowsN = max(1, round(fill * GH)), N = GW * rowsN;
const pX = new Float32Array(N), pY = new Float32Array(N), vX = new Float32Array(N), vY = new Float32Array(N);
let rndState = 20260925 >>> 0;
const rnd = () => {
  rndState = (rndState + 0x6d2b79f5) | 0;
  let s = Math.imul(rndState ^ (rndState >>> 15), 1 | rndState);
  s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
};
for (let j = 0; j < rowsN; j++)
  for (let i = 0; i < GW; i++) {
    pX[j * GW + i] = (i + 0.5 + (rnd() - 0.5) * 0.4) * h;
    pY[j * GW + i] = (j + 0.5 + (rnd() - 0.5) * 0.4) * h;
  }
const numCell = new Int32Array(GW * GH), firstCell = new Int32Array(GW * GH + 1);
const cur = new Int32Array(GW * GH), cellIds = new Int32Array(N), sFl = new Uint8Array(GW * GH);
const pushApart = (iters) => {
  const md2 = (1.1*h)*(1.1*h);
  for (let it = 0; it < iters; it++) {
    numCell.fill(0);
    for (let i = 0; i < N; i++) numCell[ci(floor(pY[i]/h),0,GH-1)*GW + ci(floor(pX[i]/h),0,GW-1)]++;
    let first = 0;
    for (let c = 0; c < GW*GH; c++) { firstCell[c] = first; first += numCell[c]; }
    firstCell[GW*GH] = first;
    cur.set(firstCell.subarray(0, GW*GH));
    for (let i = 0; i < N; i++) cellIds[cur[ci(floor(pY[i]/h),0,GH-1)*GW + ci(floor(pX[i]/h),0,GW-1)]++] = i;
    for (let i = 0; i < N; i++) {
      const xi = ci(floor(pX[i]/h),0,GW-1), yi = ci(floor(pY[i]/h),0,GH-1);
      for (let yy = max(0,yi-2); yy <= min(GH-1,yi+2); yy++)
        for (let xx = max(0,xi-2); xx <= min(GW-1,xi+2); xx++) {
          const c = yy*GW+xx;
          for (let k = firstCell[c]; k < firstCell[c+1]; k++) {
            const j2 = cellIds[k];
            if (j2 === i) continue;
            const dx = pX[j2]-pX[i], dy = pY[j2]-pY[i], d2 = dx*dx+dy*dy;
            if (d2 >= md2 || d2 < 1e-12) continue;
            const d = sqrt(d2), s = 0.7*(1.1*h - d)/d;
            const ox = dx*s, oy = dy*s;
            pX[i] -= ox; pY[i] -= oy; pX[j2] += ox; pY[j2] += oy;
            const vn = ((vX[j2] - vX[i])*dx + (vY[j2] - vY[i])*dy) / d;
            if (vn < 0) {
              const ex = (dx/d)*vn*0.45, ey = (dy/d)*vn*0.45;
              vX[i] += ex; vY[i] += ey; vX[j2] -= ex; vY[j2] -= ey;
            }
          }
        }
    }
  }
};
const u = new Float32Array(nU), v = new Float32Array(nV), up = new Float32Array(nU), vp = new Float32Array(nV);
const uw = new Float32Array(nU), vw = new Float32Array(nV);
const splatToGrid = () => {
  u.fill(0); uw.fill(0); v.fill(0); vw.fill(0);
  for (let i = 0; i < N; i++) {
    const x = ci(pX[i], 0, 1 - 1e-6), y = ci(pY[i], 0, H - 1e-6);
    let a = x/h, fi = ci(floor(a), 0, GW-1), tx = ci(a-fi, 0, 1);
    let b = y/h - 0.5, fj = ci(floor(b), 0, GH-2), ty = ci(b-fj, 0, 1);
    let row = fj*(GW+1)+fi, w;
    w = (1-tx)*(1-ty); u[row] += vX[i]*w; uw[row] += w;
    w = tx*(1-ty);     u[row+1] += vX[i]*w; uw[row+1] += w;
    w = (1-tx)*ty;     u[row+GW+1] += vX[i]*w; uw[row+GW+1] += w;
    w = tx*ty;         u[row+GW+2] += vX[i]*w; uw[row+GW+2] += w;
    a = x/h - 0.5; fi = ci(floor(a), 0, GW-2); tx = ci(a-fi, 0, 1);
    b = y/h; fj = ci(floor(b), 0, GH-1); ty = ci(b-fj, 0, 1);
    row = fj*GW+fi;
    w = (1-tx)*(1-ty); v[row] += vY[i]*w; vw[row] += w;
    w = tx*(1-ty);     v[row+1] += vY[i]*w; vw[row+1] += w;
    w = (1-tx)*ty;     v[row+GW] += vY[i]*w; vw[row+GW] += w;
    w = tx*ty;         v[row+GW+1] += vY[i]*w; vw[row+GW+1] += w;
  }
  for (let k = 0; k < nU; k++) if (uw[k] > 1e-6) u[k] /= uw[k];
  for (let k = 0; k < nV; k++) if (vw[k] > 1e-6) v[k] /= vw[k];
  for (let j = 0; j < GH; j++) { u[j*(GW+1)] = 0; u[j*(GW+1)+GW] = 0; }
  for (let i = 0; i < GW; i++) { v[i] = 0; v[GH*GW+i] = 0; }
};
const sampleU = (arr, x, y) => {
  const a = x/h, fi = ci(floor(a), 0, GW-1), tx = ci(a-fi, 0, 1);
  const b = y/h - 0.5, fj = ci(floor(b), 0, GH-2), ty = ci(b-fj, 0, 1);
  const row = fj*(GW+1)+fi;
  return arr[row]*(1-tx)*(1-ty) + arr[row+1]*tx*(1-ty) + arr[row+GW+1]*(1-tx)*ty + arr[row+GW+2]*tx*ty;
};
const sampleV = (arr, x, y) => {
  const a = x/h - 0.5, fi = ci(floor(a), 0, GW-2), tx = ci(a-fi, 0, 1);
  const b = y/h, fj = ci(floor(b), 0, GH-1), ty = ci(b-fj, 0, 1);
  const row = fj*GW+fi;
  return arr[row]*(1-tx)*(1-ty) + arr[row+1]*tx*(1-ty) + arr[row+GW]*(1-tx)*ty + arr[row+GW+1]*tx*ty;
};
const project = (iters) => {
  // solved only in water cells; faces on the water–air boundary stay free
  for (let it = 0; it < iters; it++)
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const c = j*GW+i;
        if (!sFl[c]) continue;
        const uL = j*(GW+1)+i, vB = j*GW+i;
        const div = (u[uL+1] - u[uL] + v[vB+GW] - v[vB]) / h;
        const rOK = i < GW-1 && sFl[c+1], lOK = i > 0 && sFl[c-1];
        const tOK = j < GH-1 && sFl[c+GW], bOK = j > 0 && sFl[c-GW];
        const sSum = (rOK?1:0) + (lOK?1:0) + (tOK?1:0) + (bOK?1:0);
        if (sSum === 0) continue;
        const d = div * h * relax / sSum;
        if (rOK) u[uL+1] -= d;
        if (lOK) u[uL] += d;
        if (tOK) v[vB+GW] -= d;
        if (bOK) v[vB] += d;
      }
};
let idle = 0, opx = 0.5, opy = 0.5, ocx = 0.5, ocy = 0, seen = false;
return {
  step(dt, time) {
    const M = env.mouse;
    const cx = ci(M.x, 0, 1), cy = (1 - ci(M.y, 0, 1)) * H;
    if (!seen) { opx = M.x; opy = M.y; ocx = cx; ocy = cy; seen = true; }
    if (dt <= 0) { opx = M.x; opy = M.y; ocx = cx; ocy = cy; return; }
    const dtc = min(dt, 1/30) * sp;
    const moved = abs(M.x - opx) + abs(M.y - opy) > 1e-4;
    idle = moved || M.down ? 0 : idle + dt;
    pushApart(sepIters);
    splatToGrid();
    for (let j = 1; j < GH; j++) {
      const rowV = j*GW;
      for (let i = 0; i < GW; i++) v[rowV+i] += g*dtc;
    }
    sFl.fill(0);
    for (let i = 0; i < N; i++) sFl[ci(floor(pY[i]/h),0,GH-1)*GW + ci(floor(pX[i]/h),0,GW-1)] = 1;
    up.set(u); vp.set(v);
    project(iters);
    for (let i = 0; i < N; i++) {
      const x = ci(pX[i], 0, 1 - 1e-6), y = ci(pY[i], 0, H - 1e-6);
      const gu = sampleU(u, x, y), gv = sampleV(v, x, y);
      vX[i] = flip*(vX[i] + gu - sampleU(up, x, y)) + (1-flip)*gu;
      vY[i] = flip*(vY[i] + gv - sampleV(vp, x, y)) + (1-flip)*gv;
    }
    const cvx = moved ? ci((cx - ocx)/max(dtc, 1e-4), -3, 3) : 0;
    const cvy = moved ? ci((cy - ocy)/max(dtc, 1e-4), -3, 3) : 0;
    if (moved || M.down) {
      const grab = M.down ? 0.85 : 0.3;
      for (let i = 0; i < N; i++) {
        const dx = pX[i]-cx, dy = pY[i]-cy, d2 = dx*dx+dy*dy;
        if (d2 > R*R) continue;
        const d = sqrt(d2), f = 1 - d/R, inv = 1/max(d, 0.015);
        vX[i] += dx*inv*force*dtc*f*2 + cvx*f*grab;
        vY[i] += dy*inv*force*dtc*f*2 + cvy*f*grab;
      }
    }
    if (idle > 0.8 && waveA > 0) {
      const amp = waveA * min(1, (idle-0.8)*2), ph = sin(time*3);
      for (let i = 0; i < N; i++) if (pX[i] < 0.15) vX[i] += ph*amp*6*dtc*(1 - pX[i]/0.15);
    }
    const r2 = 0.5*h;
    for (let i = 0; i < N; i++) {
      pX[i] += vX[i]*dtc; pY[i] += vY[i]*dtc;
      if (pX[i] < r2) { pX[i] = r2; if (vX[i] < 0) vX[i] = 0; }
      else if (pX[i] > 1-r2) { pX[i] = 1-r2; if (vX[i] > 0) vX[i] = 0; }
      if (pY[i] < r2) { pY[i] = r2; if (vY[i] < 0) vY[i] = 0; }
      else if (pY[i] > H-r2) { pY[i] = H-r2; if (vY[i] > 0) vY[i] = 0; }
    }
    ocx = cx; ocy = cy;
  },
  planar(cols, rows, aspect, out) {
    const dens = new Float32Array(cols*rows);
    for (let i = 0; i < N; i++) {
      const c = floor(pX[i]*cols), r = floor((1 - pY[i]/H)*rows);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const i2 = r*cols+c;
      dens[i2] += 1;
      if (c > 0) dens[i2-1] += 0.45;
      if (c < cols-1) dens[i2+1] += 0.45;
      if (r > 0) dens[i2-cols] += 0.45;
      if (r < rows-1) dens[i2+cols] += 0.45;
    }
    for (let i = 0, n = cols*rows; i < n; i++) out[i] = dens[i] < 0.05 ? -1 : min(1, max(0, 1 - exp(-dens[i]*0.6)));
  },
};`,
      "Liquid",
    ),
};
// ---------------------------------------------------------------------------
// Waves — flowing value-noise waves with a domain-warp twist; the cursor
// stirs a local ripple ring into the field.
// ---------------------------------------------------------------------------

const wavesNoise = makeNoise3(9127);

export const asciiWaves: Shape = {
  id: "ascii-waves",
  name: "Waves",
  category: "Shaders",
  description:
    "Flowing noise waves bending across the whole viewport — tension bands them, twist warps them, and the cursor stirs a local ripple.",
  animated: true,
  params: [
    { key: "noiseScale", label: "noise scale", min: 0.3, max: 3, step: 0.05, def: 1 },
    { key: "speed", label: "speed", min: 0, max: 3, step: 0.05, def: 1 },
    { key: "waveTension", label: "wave tension", min: 0.1, max: 2, step: 0.05, def: 0.5 },
    { key: "waveTwist", label: "wave twist", min: 0, max: 1, step: 0.05, def: 0.1 },
    { key: "intensity", label: "intensity", min: 0.2, max: 2, step: 0.05, def: 1 },
    { key: "interactionIntensity", label: "cursor ripple", min: 0, max: 2, step: 0.05, def: 1 },
  ],
  planar: (p, time, cols, rows, aspect, out, pointer) => {
    const ns = p.noiseScale;
    const tens = p.waveTension;
    const twist = p.waveTwist;
    const inten = p.intensity;
    const iInt = p.interactionIntensity;
    const t = time * 0.35 * p.speed;
    const ar = cols / (rows * aspect);
    const P = pointer ?? IDLE_POINTER;
    const mx = P.x * ar;
    const my = P.y;
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const v = (row + 0.5) / rows;
      for (let col = 0; col < cols; col++, i++) {
        const u = ((col + 0.5) / cols) * ar;
        const q1 = wavesNoise(u * 1.7 * ns, v * 1.7 * ns, t * 0.5) - 0.5;
        const q2 = wavesNoise(u * 1.7 * ns + 5.2, v * 1.7 * ns + 1.3, t * 0.5) - 0.5;
        const n = wavesNoise(u * 2.1 * ns + q1 * twist * 4, v * 2.1 * ns + q2 * twist * 4, t);
        let lum = 0.5 + Math.sin((n * 2 - 1) * (1.4 + tens * 3.5) + t * 1.8) * 0.44 * inten;
        if (iInt > 0) {
          const dx = u - mx;
          const dy = v - my;
          const d2 = dx * dx + dy * dy;
          lum += iInt * 0.45 * Math.exp(-d2 * 14) * Math.sin(Math.sqrt(d2) * 20 - t * 5);
        }
        out[i] = clamp01(lum);
      }
    }
  },
  toCode: (p) =>
    planarCode(
      `// flowing value-noise waves — the cursor stirs a local ripple
const ns = ${F(p.noiseScale)}, tens = ${F(p.waveTension)}, twist = ${F(p.waveTwist)};
const inten = ${F(p.intensity)}, iInt = ${F(p.interactionIntensity)}, sp = ${F(p.speed)};
const fract = (x) => x - floor(x);
const hash = (x, y, z) => fract(sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const fade = (x) => x * x * (3 - 2 * x);
const noise = (x, y, z) => {
  const xi = floor(x), yi = floor(y), zi = floor(z);
  const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
  const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
  const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
};
const tt = t * 0.35 * sp;
const ar = cols / (rows * aspect), S = ar / 4;
const xu = (u + 2) * S, yv = 0.5 - v * S;
const q1 = noise(xu * 1.7 * ns, yv * 1.7 * ns, tt * 0.5) - 0.5;
const q2 = noise(xu * 1.7 * ns + 5.2, yv * 1.7 * ns + 1.3, tt * 0.5) - 0.5;
const n = noise(xu * 2.1 * ns + q1 * twist * 4, yv * 2.1 * ns + q2 * twist * 4, tt);
let lum = 0.5 + sin((n * 2 - 1) * (1.4 + tens * 3.5) + tt * 1.8) * 0.44 * inten;
if (iInt > 0) {
  const dx = xu - (mx + 2) * S, dy = yv - (0.5 - my * S);
  const d2 = dx * dx + dy * dy;
  lum += iInt * 0.45 * exp(-d2 * 14) * sin(sqrt(d2) * 20 - tt * 5);
}
return min(1, max(0, lum));`,
      4,
      "Waves",
    ),
};

// ---------------------------------------------------------------------------
// Tiles — a sheared field of glassy tiles: bevel rims, an animated
// specular highlight, per-tile glyph patterns sampled through a fake
// refraction offset, and cursor proximity that scrambles the pattern.
// ---------------------------------------------------------------------------

export const asciiTiles: Shape = {
  id: "ascii-tiles",
  name: "Tiles",
  category: "Shaders",
  description:
    "A field of glassy glyph tiles — sheared, beveled and specular-lit, with the pattern refracting near tile edges and scrambling under the cursor.",
  animated: true,
  params: [
    { key: "speed", label: "speed", min: 0, max: 3, step: 0.05, def: 1 },
    { key: "tileDensity", label: "tile density", min: 1, max: 12, step: 0.1, def: 3.3 },
    { key: "tileShear", label: "tile shear", min: -0.5, max: 0.5, step: 0.02, def: -0.22 },
    { key: "bevelWidth", label: "bevel width", min: 0.005, max: 0.25, step: 0.005, def: 0.06 },
    { key: "refractionStrength", label: "refraction", min: 0, max: 1, step: 0.05, def: 0.35 },
    { key: "specularStrength", label: "specular", min: 0, max: 2, step: 0.05, def: 1 },
    { key: "patternFreqX", label: "pattern freq X", min: 1, max: 16, step: 0.5, def: 6 },
    { key: "patternFreqY", label: "pattern freq Y", min: 1, max: 16, step: 0.5, def: 4 },
    { key: "patternFreqXY", label: "pattern freq XY", min: 1, max: 16, step: 0.5, def: 10 },
    { key: "cursorRadius", label: "cursor radius", min: 0.05, max: 0.6, step: 0.01, def: 0.18 },
    { key: "cursorIntensity", label: "cursor scramble", min: 0, max: 2, step: 0.05, def: 1 },
  ],
  planar: (p, time, cols, rows, aspect, out, pointer) => {
    const t = time * p.speed;
    const ar = cols / (rows * aspect);
    const tile = Math.max(ar, 1) / clamp(p.tileDensity, 0.5, 12);
    const P = pointer ?? IDLE_POINTER;
    const mx = P.x * ar;
    const my = P.y;
    const cR = Math.max(0.02, p.cursorRadius);
    const cI = p.cursorIntensity;
    const bwd = clamp(p.bevelWidth, 0.001, 0.45);
    const refr = p.refractionStrength * 0.4;
    const spec = p.specularStrength;
    const fqX = p.patternFreqX * Math.PI * 2;
    const fqY = p.patternFreqY * Math.PI * 2;
    const fqXY = p.patternFreqXY * Math.PI * 2;
    const lx = Math.cos(t * 0.37);
    const ly = Math.sin(t * 0.29);
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) / rows;
      for (let col = 0; col < cols; col++, i++) {
        const x = ((col + 0.5) / cols) * ar;
        const cdx = x - mx;
        const cdy = y - my;
        const warp = cI > 0 ? Math.exp(-(cdx * cdx + cdy * cdy) / (cR * cR)) : 0;
        const scr = warp * 12;
        const tx = (x + p.tileShear * y) / tile;
        const ty = y / tile;
        const ix = Math.floor(tx);
        const iy = Math.floor(ty);
        const fx = tx - ix;
        const fy = ty - iy;
        const bx = Math.min(fx, 1 - fx);
        const by = Math.min(fy, 1 - fy);
        const b = Math.min(bx, by);
        const edge = clamp01((b - bwd * 0.2) / (bwd * 3));
        const xSide = bx < by;
        const nx = xSide ? (fx < 0.5 ? -1 : 1) : 0;
        const ny = xSide ? 0 : fy < 0.5 ? -1 : 1;
        // fake refraction: push the pattern sample inward near the bevels
        const fall = (1 - edge) * refr;
        const px = fx + nx * fall;
        const py = fy + ny * fall;
        const phase = Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
        let pat =
          Math.sin(px * fqX + t * 1.3 + phase + scr) *
          Math.sin(py * fqY - t * 0.9 + phase * 1.7 + scr) *
          Math.sin((px + py) * fqXY + t * 0.6);
        pat *= 1 - 0.85 * Math.min(1, warp * 2);
        let lum = 0.06 + pat * 0.16;
        lum += (1 - edge) * 0.38;
        lum += Math.pow(Math.max(0, nx * lx + ny * ly), 20) * spec * (0.3 + 0.7 * (1 - edge));
        out[i] = clamp01(lum);
      }
    }
  },
  toCode: (p) =>
    planarCode(
      `// glassy glyph tiles — bevel rims, moving specular, cursor scrambling
const sp = ${F(p.speed)}, tile = ${F(1 / clamp(p.tileDensity, 0.5, 12))} * max(cols / (rows * aspect), 1);
const shear = ${F(p.tileShear)}, bwd = ${F(clamp(p.bevelWidth, 0.001, 0.45))}, refr = ${F(p.refractionStrength * 0.4)};
const spec = ${F(p.specularStrength)};
const fqX = ${F(p.patternFreqX * Math.PI * 2)}, fqY = ${F(p.patternFreqY * Math.PI * 2)}, fqXY = ${F(p.patternFreqXY * Math.PI * 2)};
const cR = ${F(Math.max(0.02, p.cursorRadius))}, cI = ${F(p.cursorIntensity)};
const tt = t * sp;
const ar = cols / (rows * aspect), S = ar / 4;
const x = (u + 2) * S, y = 0.5 - v * S;
const mxv = (mx + 2) * S, myv = 0.5 - my * S;
const cdx = x - mxv, cdy = y - myv;
const warp = cI > 0 ? exp(-(cdx * cdx + cdy * cdy) / (cR * cR)) : 0;
const scr = warp * 12;
const tx = (x + shear * y) / tile, ty = y / tile;
const ix = floor(tx), iy = floor(ty);
const fx = tx - ix, fy = ty - iy;
const bx = min(fx, 1 - fx), by = min(fy, 1 - fy);
const b = min(bx, by);
const edge = min(1, max(0, (b - bwd * 0.2) / (bwd * 3)));
const nx = bx < by ? (fx < 0.5 ? -1 : 1) : 0;
const ny = bx < by ? 0 : (fy < 0.5 ? -1 : 1);
const fall = (1 - edge) * refr;
const px = fx + nx * fall, py = fy + ny * fall;
const phase = sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
let pat = sin(px * fqX + tt * 1.3 + phase + scr) *
  sin(py * fqY - tt * 0.9 + phase * 1.7 + scr) *
  sin((px + py) * fqXY + tt * 0.6);
pat *= 1 - 0.85 * min(1, warp * 2);
let lum = 0.06 + pat * 0.16 + (1 - edge) * 0.38;
lum += pow(max(0, nx * cos(tt * 0.37) + ny * sin(tt * 0.29)), 20) * spec * (0.3 + 0.7 * (1 - edge));
return min(1, max(0, lum));`,
      4,
      "Tiles",
    ),
};

// ---------------------------------------------------------------------------
// Cursor — a persistent glyph trail behind the pointer: stamps a soft
// brush along the motion path, decays exponentially, optional bloom glow.
// ---------------------------------------------------------------------------

const CW = 176;
const CH = 99;

export const asciiCursor: Shape = {
  id: "ascii-cursor",
  name: "Cursor",
  category: "Simulations",
  description:
    "A fading ASCII trail left behind the pointer — moves smear into a brushed wake, presses stamp harder, and bloom lights a glow around bright cells.",
  animated: true,
  params: [
    { key: "size", label: "brush size", min: 2, max: 16, step: 0.5, def: 5 },
    { key: "spread", label: "motion spread", min: 0, max: 3, step: 0.05, def: 0.8 },
    { key: "persistence", label: "persistence", min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: "intensity", label: "intensity", min: 0.2, max: 2, step: 0.05, def: 1 },
    { key: "bloomStrength", label: "bloom", min: 0, max: 3, step: 0.05, def: 0 },
  ],
  sim: (p): Sim => {
    const n = CW * CH;
    const trail = new Float32Array(n);
    const blur = new Float32Array(n);
    let px = 0.5;
    let py = 0.5;
    let seen = false;

    const stamp = (cx: number, cy: number, r: number, a: number) => {
      const r2 = r * r * 0.45;
      const x0 = Math.max(0, Math.floor(cx - r * 1.8));
      const x1 = Math.min(CW - 1, Math.ceil(cx + r * 1.8));
      const y0 = Math.max(0, Math.floor(cy - r * 1.8));
      const y1 = Math.min(CH - 1, Math.ceil(cy + r * 1.8));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const w = a * Math.exp(-(dx * dx + dy * dy) / r2);
          const i = y * CW + x;
          if (w > trail[i]) trail[i] = w;
        }
      }
    };

    return {
      step(dt, _time, _out, pointer) {
        const P = pointer ?? IDLE_POINTER;
        if (!seen) {
          px = P.x;
          py = P.y;
          seen = true;
          // seed a soft blob so the shape starts visible before any motion
          stamp(P.x * CW, P.y * CH, p.size, p.intensity * 0.8);
          if (dt <= 0) return;
        }
        if (dt <= 0) {
          px = P.x;
          py = P.y;
          return;
        }
        const decay = Math.exp((-dt * 2.4) / Math.max(0.05, p.persistence));
        for (let i = 0; i < n; i++) trail[i] *= decay;
        const sx = P.x * CW;
        const sy = P.y * CH;
        const psx = px * CW;
        const psy = py * CH;
        const dx = sx - psx;
        const dy = sy - psy;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.05) {
          const speed = dist / Math.max(dt, 1 / 240);
          const r = p.size * (1 + Math.min(2, speed * 0.004) * p.spread);
          const a = p.intensity * (P.down ? 1.5 : 1);
          const steps = Math.min(48, Math.max(1, Math.ceil(dist / Math.max(0.6, r * 0.5))));
          for (let s = 1; s <= steps; s++) {
            const f = s / steps;
            stamp(psx + dx * f, psy + dy * f, r, a);
          }
        }
        if (p.bloomStrength > 0) {
          for (let y = 1; y < CH - 1; y++) {
            const row = y * CW;
            for (let x = 1; x < CW - 1; x++) {
              const i = row + x;
              blur[i] =
                (trail[i - 1] +
                  trail[i + 1] +
                  trail[i - CW] +
                  trail[i + CW] +
                  trail[i - CW - 1] +
                  trail[i - CW + 1] +
                  trail[i + CW - 1] +
                  trail[i + CW + 1]) *
                0.125;
            }
          }
          const glow = p.bloomStrength * 0.3;
          for (let i = 0; i < n; i++) trail[i] = Math.min(1, trail[i] + glow * blur[i]);
        }
        px = P.x;
        py = P.y;
      },
      planar(cols, rows, _aspect, out) {
        for (let row = 0; row < rows; row++) {
          const gy = clamp(Math.floor((row / rows) * CH), 0, CH - 1);
          const rowOff = gy * CW;
          for (let col = 0; col < cols; col++) {
            const gx = clamp(Math.floor((col / cols) * CW), 0, CW - 1);
            const t = trail[rowOff + gx];
            out[row * cols + col] = t > 0.004 ? clamp01(t) : -1;
          }
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// ASCII cursor trail — a fading glyph wake behind the pointer
// env.mouse: live pointer { x, y in 0..1 (y down), down }
const CW = ${CW}, CH = ${CH};
const SZ = ${F(p.size)}, SPR = ${F(p.spread)}, PERS = ${F(p.persistence)}, BLOOM = ${F(p.bloomStrength)}, INT = ${F(p.intensity)};
const trail = new Float32Array(CW * CH), blur = new Float32Array(CW * CH);
let px = 0.5, py = 0.5, seen = false;
const stamp = (cx, cy, r, a) => {
  const r2 = r * r * 0.45;
  const x0 = max(0, floor(cx - r * 1.8)), x1 = min(CW - 1, ceil(cx + r * 1.8));
  const y0 = max(0, floor(cy - r * 1.8)), y1 = min(CH - 1, ceil(cy + r * 1.8));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const w = a * exp(-(dx * dx + dy * dy) / r2);
      const i = y * CW + x;
      if (w > trail[i]) trail[i] = w;
    }
};
return {
  step(dt) {
    const M = env.mouse;
    if (!seen) { px = M.x; py = M.y; seen = true; if (dt <= 0) return; }
    if (dt <= 0) { px = M.x; py = M.y; return; }
    const dec = exp(-dt * 2.4 / max(0.05, PERS));
    for (let i = 0, n = CW * CH; i < n; i++) trail[i] *= dec;
    const sx = M.x * CW, sy = M.y * CH;
    const dx = sx - px * CW, dy = sy - py * CH;
    const dist = hypot(dx, dy);
    if (dist > 0.05) {
      const speed = dist / max(dt, 1 / 240);
      const r = SZ * (1 + min(2, speed * 0.004) * SPR);
      const a = INT * (M.down ? 1.5 : 1);
      const steps = min(48, max(1, ceil(dist / max(0.6, r * 0.5))));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        stamp(px * CW + dx * f, py * CH + dy * f, r, a);
      }
    }
    if (BLOOM > 0) {
      for (let y = 1; y < CH - 1; y++)
        for (let x = 1; x < CW - 1; x++) {
          const i = y * CW + x;
          blur[i] = (trail[i - 1] + trail[i + 1] + trail[i - CW] + trail[i + CW] +
            trail[i - CW - 1] + trail[i - CW + 1] + trail[i + CW - 1] + trail[i + CW + 1]) * 0.125;
        }
      for (let i = 0, n = CW * CH; i < n; i++) trail[i] = min(1, trail[i] + BLOOM * 0.3 * blur[i]);
    }
    px = M.x; py = M.y;
  },
  planar(cols, rows, aspect, out) {
    for (let row = 0; row < rows; row++) {
      const gy = max(0, min(CH - 1, floor((row / rows) * CH)));
      for (let col = 0; col < cols; col++) {
        const gx = max(0, min(CW - 1, floor((col / cols) * CW)));
        const t2 = trail[gy * CW + gx];
        out[row * cols + col] = t2 > 0.004 ? t2 : -1;
      }
    }
  },
};`,
      "Cursor",
    ),
};
