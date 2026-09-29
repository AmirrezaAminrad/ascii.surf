import { framePush, type PointFrame, type SurfaceFn, type Vec3 } from "./types";

export const TAU = Math.PI * 2;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Format a number for generated code: trims float noise ("0.7", not "0.70000001"). */
export function fmtNum(n: number): string {
  return String(+n.toFixed(4));
}

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RK4 integrator with preallocated scratch: dy/dt = f(y). */
interface Rk4 {
  readonly y: Float64Array;
  step(dt: number): void;
}

export function makeRk4(n: number, f: (y: Float64Array, dy: Float64Array) => void): Rk4 {
  const y = new Float64Array(n);
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const yt = new Float64Array(n);
  return {
    y,
    step(dt) {
      f(y, k1);
      for (let i = 0; i < n; i++) yt[i] = y[i] + (dt / 2) * k1[i];
      f(yt, k2);
      for (let i = 0; i < n; i++) yt[i] = y[i] + (dt / 2) * k2[i];
      f(yt, k3);
      for (let i = 0; i < n; i++) yt[i] = y[i] + dt * k3[i];
      f(yt, k4);
      for (let i = 0; i < n; i++) y[i] += (dt / 6) * (k1[i] + 2 * (k2[i] + k3[i]) + k4[i]);
    },
  };
}

/**
 * Tube around a curve with parallel-transported frames. The returned fn is
 * stateful and assumes the renderer's sampling order: u ascending across each
 * pass, with the renderer's ±1e-3 finite-difference probes around each u.
 * Transport restarts when u jumps backwards beyond the probe distance.
 */
export function makeTube(curveAt: (s: number) => Vec3, radiusAt: (s: number) => number): SurfaceFn {
  const H = 1e-3; // tangent finite-difference step
  const EPS = 5e-3; // resync threshold: probes are ±1e-3, grid steps are larger
  let prevU = -1;
  let nx = 0;
  let ny = 0;
  let nz = 1;
  return (u, v) => {
    const a = curveAt(Math.max(0, u - H));
    const b = curveAt(Math.min(1, u + H));
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;

    if (prevU < 0 || u < prevU - EPS) {
      // new sampling pass (or first call): seed the normal from T × up
      const rx = 0;
      let ry = 0;
      let rz = 1;
      if (Math.abs(tz) > 0.9) {
        ry = 1;
        rz = 0;
      }
      nx = ty * rz - tz * ry;
      ny = tz * rx - tx * rz;
      nz = tx * ry - ty * rx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
    } else if (u > prevU + EPS || u < prevU) {
      // forward grid step, or the backward ±H probe: re-orthogonalize the frame
      const d = nx * tx + ny * ty + nz * tz;
      nx -= d * tx;
      ny -= d * ty;
      nz -= d * tz;
      const nl = Math.hypot(nx, ny, nz);
      if (nl > 1e-9) {
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
    }
    // equal-u probes (v variation) keep the frame untouched
    prevU = u;

    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;
    const r = radiusAt(u);
    const c = curveAt(u);
    const cv = Math.cos(v);
    const sv = Math.sin(v);
    return [
      c[0] + r * (cv * nx + sv * bx),
      c[1] + r * (cv * ny + sv * by),
      c[2] + r * (cv * nz + sv * bz),
    ];
  };
}

/** Sample a triangle (flat normal) with a triangular point grid, n points per edge. */
export function pushTri(
  pf: PointFrame,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  nx: number,
  ny: number,
  nz: number,
  n: number,
): void {
  const d = n - 1;
  for (let i = 0; i < n; i++) {
    const s = d === 0 ? 0 : i / d; // weight of c
    for (let j = 0; j + i < n; j++) {
      const t = d === 0 ? 0 : j / d; // weight of b
      const w = 1 - s - t; // weight of a
      framePush(
        pf,
        w * a[0] + t * b[0] + s * c[0],
        w * a[1] + t * b[1] + s * c[1],
        w * a[2] + t * b[2] + s * c[2],
        nx,
        ny,
        nz,
      );
    }
  }
}

/** Sample a convex polygon as a fan around its centroid, with an outward flat normal. */
export function pushPoly(pf: PointFrame, pts: Vec3[], n: number): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const m = pts.length;
  const c: Vec3 = [cx / m, cy / m, cz / m];
  const a = pts[0];
  const b = pts[1];
  const e1: Vec3 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const e2: Vec3 = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1];
  let ny = e1[2] * e2[0] - e1[0] * e2[2];
  let nz = e1[0] * e2[1] - e1[1] * e2[0];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  for (let k = 0; k < m; k++) {
    pushTri(pf, c, pts[k], pts[(k + 1) % m], nx, ny, nz, n);
  }
}

/** Seeded 3D value noise (trilinear, smooth-faded) for flow fields. */
export function makeNoise3(seed: number): (x: number, y: number, z: number) => number {
  const rnd = mulberry32(seed);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rnd();
  const tab = new Uint8Array(512);
  for (let i = 0; i < 256; i++) tab[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = tab[i];
    tab[i] = tab[j];
    tab[j] = t;
  }
  for (let i = 0; i < 256; i++) tab[256 + i] = tab[i];
  const h = (x: number, y: number, z: number) =>
    vals[tab[(x + tab[(y + tab[z & 255]) & 255]) & 255]];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const v000 = h(ix, iy, iz);
    const v100 = h(ix + 1, iy, iz);
    const v010 = h(ix, iy + 1, iz);
    const v110 = h(ix + 1, iy + 1, iz);
    const v001 = h(ix, iy, iz + 1);
    const v101 = h(ix + 1, iy, iz + 1);
    const v011 = h(ix, iy + 1, iz + 1);
    const v111 = h(ix + 1, iy + 1, iz + 1);
    const vx00 = v000 + (v100 - v000) * fx;
    const vx10 = v010 + (v110 - v010) * fx;
    const vx01 = v001 + (v101 - v001) * fx;
    const vx11 = v011 + (v111 - v011) * fx;
    const vxy0 = vx00 + (vx10 - vx00) * fy;
    const vxy1 = vx01 + (vx11 - vx01) * fy;
    return vxy0 + (vxy1 - vxy0) * fz;
  };
}
