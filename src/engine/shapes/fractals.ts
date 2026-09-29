import { clamp, clamp01, fmtNum, mulberry32 } from "../math";

const F = fmtNum;
import {
  frameGlow,
  framePush,
  implicitCode,
  planarCode,
  generateCode,
  type Shape,
  type Vec3,
} from "../types";

const qualityParam = { key: "quality", label: "grid quality", min: 20, max: 96, step: 2, def: 56 };

// ---------------------------------------------------------------------------
// Menger sponge — exact level set of the standard sponge distance estimator,
// evaluated on the renderer's implicit grid (iq's well-known formula):
//   d = sdBox(p, 1); s = 1;
//   repeat depth times: a = mod(p·s, 2) − 1; s *= 3;
//     r = |1 − 3|a||; c = (min(max(r.x,r.y), max(r.y,r.z), max(r.z,r.x)) − 1)/s;
//     d = max(d, c)
// ---------------------------------------------------------------------------

function sdBox(x: number, y: number, z: number, b: number): number {
  const ax = Math.abs(x) - b;
  const ay = Math.abs(y) - b;
  const az = Math.abs(z) - b;
  const mx = Math.max(ax, ay, az);
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) + Math.min(mx, 0);
}

export const menger: Shape = {
  id: "menger",
  name: "Menger Sponge",
  category: "Fractals",
  description:
    "Recursive cube subdivision: every face keeps its 3×3 cross of holes. Surface shown as the exact level set at recursion depth d. Depth 4 is best-effort: its finest holes sit below the default grid resolution — raise grid quality toward 96 for full detail.",
  animated: false,
  params: [
    { key: "depth", label: "recursion depth", min: 0, max: 4, step: 1, def: 3, int: true },
    qualityParam,
  ],
  implicit: (p) => ({
    f: (x, y, z) => {
      const px = x / 1.2,
        py = y / 1.2,
        pz = z / 1.2;
      let d = sdBox(px, py, pz, 1);
      let s = 1;
      const depth = clamp(Math.round(p.depth), 0, 4);
      for (let m = 0; m < depth; m++) {
        const ax = ((((px * s) % 2) + 2) % 2) - 1;
        const ay = ((((py * s) % 2) + 2) % 2) - 1;
        const az = ((((pz * s) % 2) + 2) % 2) - 1;
        s *= 3;
        const rx = Math.abs(1 - 3 * Math.abs(ax));
        const ry = Math.abs(1 - 3 * Math.abs(ay));
        const rz = Math.abs(1 - 3 * Math.abs(az));
        const da = Math.max(rx, ry);
        const db = Math.max(ry, rz);
        const dc = Math.max(rz, rx);
        const c = (Math.min(da, db, dc) - 1) / s;
        d = Math.max(d, c);
      }
      return d * 1.2;
    },
    bound: 1.26,
    iso: 0,
  }),
  toCode: (p) =>
    implicitCode(
      `// Menger sponge level set (exact distance estimator), box half-size 1.2
const depth = ${clamp(Math.round(p.depth), 0, 4)};
const px = x / 1.2, py = y / 1.2, pz = z / 1.2;
const qx = abs(px) - 1, qy = abs(py) - 1, qz = abs(pz) - 1;
let d = hypot(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, max(qy, qz)), 0);
let s = 1;
for (let m = 0; m < depth; m++) {
  const ax = ((px * s) % 2 + 2) % 2 - 1;
  const ay = ((py * s) % 2 + 2) % 2 - 1;
  const az = ((pz * s) % 2 + 2) % 2 - 1;
  s *= 3;
  const rx = abs(1 - 3 * abs(ax));
  const ry = abs(1 - 3 * abs(ay));
  const rz = abs(1 - 3 * abs(az));
  const c = (min(max(rx, ry), max(ry, rz), max(rz, rx)) - 1) / s;
  d = max(d, c);
}
return d * 1.2;`,
      1.26,
      0,
      "Menger Sponge",
    ),
};

// ---------------------------------------------------------------------------
// Sierpiński tetrahedron (tetrix) — recursive corner sub-tetrahedra, leaf
// faces sampled as flat-shaded triangles.
// ---------------------------------------------------------------------------

const BASE_TET: Vec3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
].map((v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [(v[0] / l) * 1.55, (v[1] / l) * 1.55, (v[2] / l) * 1.55] as Vec3;
});

const FACE_GRID_BY_DEPTH = [12, 12, 9, 7, 5, 4];

export const sierpinski: Shape = {
  id: "sierpinski",
  name: "Sierpiński Tetra.",
  category: "Fractals",
  description:
    "The tetrix: every tetrahedron spawns four half-size copies of itself. 4^depth leaf solids, flat-shaded faces.",
  animated: false,
  params: [{ key: "depth", label: "recursion depth", min: 0, max: 5, step: 1, def: 3, int: true }],
  generate: (p, _time, out) => {
    const depth = clamp(Math.round(p.depth), 0, 5);
    const grid = FACE_GRID_BY_DEPTH[depth];
    const leaves: Vec3[][] = [];
    const sub = (tet: Vec3[], d: number) => {
      if (d === 0) {
        leaves.push(tet);
        return;
      }
      const mid = (i: number, j: number): Vec3 => [
        (tet[i][0] + tet[j][0]) / 2,
        (tet[i][1] + tet[j][1]) / 2,
        (tet[i][2] + tet[j][2]) / 2,
      ];
      const M = [mid(0, 1), mid(0, 2), mid(0, 3), mid(1, 2), mid(1, 3), mid(2, 3)];
      // corner k keeps vertex k and the three midpoints adjacent to it
      sub([tet[0], M[0], M[1], M[2]], d - 1);
      sub([tet[1], M[0], M[3], M[4]], d - 1);
      sub([tet[2], M[1], M[3], M[5]], d - 1);
      sub([tet[3], M[2], M[4], M[5]], d - 1);
    };
    sub(BASE_TET, depth);
    for (const tet of leaves) {
      const tc: Vec3 = [
        (tet[0][0] + tet[1][0] + tet[2][0] + tet[3][0]) / 4,
        (tet[0][1] + tet[1][1] + tet[2][1] + tet[3][1]) / 4,
        (tet[0][2] + tet[1][2] + tet[2][2] + tet[3][2]) / 4,
      ];
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 4; c++) {
            const A = tet[a],
              B = tet[b],
              C = tet[c];
            const e1: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
            const e2: Vec3 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            let nx = e1[1] * e2[2] - e1[2] * e2[1];
            let ny = e1[2] * e2[0] - e1[0] * e2[2];
            let nz = e1[0] * e2[1] - e1[1] * e2[0];
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            // flip so the normal points away from the tetrahedron's center
            const fc: Vec3 = [
              (A[0] + B[0] + C[0]) / 3,
              (A[1] + B[1] + C[1]) / 3,
              (A[2] + B[2] + C[2]) / 3,
            ];
            if ((fc[0] - tc[0]) * nx + (fc[1] - tc[1]) * ny + (fc[2] - tc[2]) * nz < 0) {
              nx = -nx;
              ny = -ny;
              nz = -nz;
            }
            for (let i = 0; i < grid; i++) {
              const s = grid === 1 ? 0 : i / (grid - 1);
              for (let j = 0; j + i < grid; j++) {
                const t = grid === 1 ? 0 : j / (grid - 1);
                const w = 1 - s - t;
                framePush(
                  out,
                  w * A[0] + t * B[0] + s * C[0],
                  w * A[1] + t * B[1] + s * C[1],
                  w * A[2] + t * B[2] + s * C[2],
                  nx,
                  ny,
                  nz,
                );
              }
            }
          }
        }
      }
    }
  },
  toCode: (p) =>
    generateCode(
      `// Sierpiński tetrahedron: each tetra spawns 4 half-size copies
const depth = ${clamp(Math.round(p.depth), 0, 5)};
const s0 = 1.55 / sqrt(3);
let leaves = [
  [[s0, s0, s0], [s0, -s0, -s0], [-s0, s0, -s0], [-s0, -s0, s0]]
];
for (let d = 0; d < depth; d++) {
  const next = [];
  for (const tet of leaves) {
    const M = [];
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        M.push([
          (tet[i][0] + tet[j][0]) / 2,
          (tet[i][1] + tet[j][1]) / 2,
          (tet[i][2] + tet[j][2]) / 2
        ]);
    // corner k keeps vertex k and its three adjacent midpoints
    next.push([tet[0], M[0], M[1], M[2]], [tet[1], M[0], M[3], M[4]],
              [tet[2], M[1], M[3], M[5]], [tet[3], M[2], M[4], M[5]]);
  }
  leaves = next;
}
const grids = [12, 12, 9, 7, 5, 4];
const n = grids[Math.min(depth, 5)];
for (const tet of leaves) {
  let tx = 0, ty = 0, tz = 0;
  for (const v of tet) { tx += v[0]; ty += v[1]; tz += v[2]; }
  tx /= 4; ty /= 4; tz /= 4;
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 4; c++) {
        const A = tet[a], B = tet[b], C = tet[c];
        const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
        const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const nl = hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const fx = (A[0] + B[0] + C[0]) / 3, fy = (A[1] + B[1] + C[1]) / 3, fz = (A[2] + B[2] + C[2]) / 3;
        if ((fx - tx) * nx + (fy - ty) * ny + (fz - tz) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        for (let i = 0; i < n; i++) {
          const s0 = i / (n - 1);
          for (let j = 0; j + i < n; j++) {
            const t0 = j / (n - 1);
            const w0 = 1 - s0 - t0;
            push(
              w0 * A[0] + t0 * B[0] + s0 * C[0],
              w0 * A[1] + t0 * B[1] + s0 * C[1],
              w0 * A[2] + t0 * B[2] + s0 * C[2],
              nx, ny, nz
            );
          }
        }
      }
}`,
      "Sierpiński Tetrahedron",
    ),
};

// ---------------------------------------------------------------------------
// Mandelbrot & Julia — planar escape-time fields with smooth coloring.
// aspect maps world units to the char-cell grid so pixels stay square.
// ---------------------------------------------------------------------------

function fillEscapeTime(
  out: Float32Array,
  cols: number,
  rows: number,
  aspect: number,
  cx: number,
  cy: number,
  span: number,
  maxIter: number,
  juliaCr: number | null,
  juliaCi: number,
): void {
  const hspan = (span * rows * aspect) / cols;
  const li = Math.log(2);
  const cell = (x0: number, y0: number): number => {
    const cr = juliaCr === null ? x0 : juliaCr;
    const ci = juliaCr === null ? y0 : juliaCi;
    let zr = juliaCr === null ? 0 : x0;
    let zi = juliaCr === null ? 0 : y0;
    let zr2 = zr * zr;
    let zi2 = zi * zi;
    let i = 0;
    while (i < maxIter && zr2 + zi2 <= 64) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr;
      zi2 = zi * zi;
      i++;
    }
    if (i >= maxIter) return 0.08; // set body: darkest visible char, not empty
    const logzn = Math.log(zr2 + zi2) / 2;
    const nu = Math.log(logzn / li) / li;
    return Math.min(1, Math.pow(clamp01((i + 1 - nu) / maxIter), 0.42) * 1.3);
  };
  // 2×2 supersampling, averaged — proper anti-aliasing of the escape-time field
  for (let row = 0; row < rows; row++) {
    const base = row * cols;
    for (let col = 0; col < cols; col++) {
      const wx = ((col + 0.5) / cols - 0.5) * span;
      const wy = (0.5 - (row + 0.5) / rows) * hspan;
      const dx = span / cols / 2;
      const dy = hspan / rows / 2;
      const l =
        (cell(cx + wx - dx / 2, cy + wy - dy / 2) +
          cell(cx + wx + dx / 2, cy + wy - dy / 2) +
          cell(cx + wx - dx / 2, cy + wy + dy / 2) +
          cell(cx + wx + dx / 2, cy + wy + dy / 2)) /
        4;
      out[base + col] = l;
    }
  }
}

/** Last static Mandelbrot frame — non-animating views skip the ~1M escape-time iterations. */
let mandelbrotCache: { key: string; buf: Float32Array } | null = null;

export const mandelbrot: Shape = {
  id: "mandelbrot",
  name: "Mandelbrot",
  category: "Fractals",
  description:
    "Escape-time density of z ↦ z² + c over the plane. Zoom in (try the seahorse valley at −0.745, 0.113) or switch on the animated dive.",
  animated: true, // keeps autozoom running; static views hit the frame cache below
  params: [
    { key: "zoom", label: "zoom", min: 0, max: 13, step: 0.1, def: 0 },
    { key: "cx", label: "center x", min: -2, max: 1, step: 0.005, def: -0.7 },
    { key: "cy", label: "center y", min: -1.2, max: 1.2, step: 0.005, def: 0 },
    { key: "maxIter", label: "max iterations", min: 20, max: 500, step: 10, def: 120, int: true },
    { key: "autozoom", label: "auto-zoom (0|1)", min: 0, max: 1, step: 1, def: 0, int: true },
    { key: "zoomspeed", label: "zoom speed", min: 0.05, max: 1, step: 0.05, def: 0.22 },
  ],
  planar: (p, time, cols, rows, aspect, out) => {
    const zooming = p.autozoom >= 1;
    const z = p.zoom + (zooming ? time * p.zoomspeed : 0);
    const span = Math.max(3.4 * Math.pow(2, -z), 1e-7);
    if (zooming) {
      fillEscapeTime(out, cols, rows, aspect, p.cx, p.cy, span, Math.round(p.maxIter), null, 0);
      return;
    }
    const key = `${p.zoom}|${p.cx}|${p.cy}|${p.maxIter}|${cols}|${rows}|${aspect}|${span}`;
    if (
      !mandelbrotCache ||
      mandelbrotCache.key !== key ||
      mandelbrotCache.buf.length !== out.length
    ) {
      const buf = new Float32Array(out.length);
      fillEscapeTime(buf, cols, rows, aspect, p.cx, p.cy, span, Math.round(p.maxIter), null, 0);
      mandelbrotCache = { key, buf };
    }
    out.set(mandelbrotCache.buf);
  },
  toCode: (p) =>
    planarCode(
      `// Mandelbrot escape-time density: z ↦ z² + c, c = center + pixel offset
const maxIter = ${Math.round(p.maxIter)};
let zr = 0, zi = 0, i = 0;
const cr = ${F(p.cx)} + u, ci = ${F(p.cy)} + v;
while (i < maxIter && zr * zr + zi * zi <= 64) {
  const nextR = zr * zr - zi * zi + cr;
  zi = 2 * zr * zi + ci;
  zr = nextR;
  i++;
}
if (i >= maxIter) return 0.08; // inside the set: darkest char
const logzn = log(zr * zr + zi * zi) / 2;
const nu = log(logzn / LN2) / LN2;
const s = (i + 1 - nu) / maxIter;
return min(1, pow(max(0, min(1, s)), 0.42) * 1.3);`,
      Math.max(3.4 * Math.pow(2, -p.zoom), 1e-7),
      "Mandelbrot",
    ),
};

export const julia: Shape = {
  id: "julia",
  name: "Julia Set",
  category: "Fractals",
  description:
    "Escape-time field of z ↦ z² + c for a fixed complex c — drag c around, or let it orbit the circle |c| = 0.7885.",
  animated: true,
  params: [
    { key: "cre", label: "c real", min: -1.2, max: 1.2, step: 0.005, def: -0.8 },
    { key: "cim", label: "c imaginary", min: -1.2, max: 1.2, step: 0.005, def: 0.156 },
    { key: "morph", label: "animate c (0|1)", min: 0, max: 1, step: 1, def: 0, int: true },
    { key: "speed", label: "morph speed", min: 0.05, max: 1, step: 0.05, def: 0.18 },
    { key: "zoom", label: "zoom", min: 0, max: 10, step: 0.1, def: 0 },
    { key: "maxIter", label: "max iterations", min: 20, max: 500, step: 10, def: 150, int: true },
  ],
  planar: (p, time, cols, rows, aspect, out) => {
    const span = Math.max(3.6 * Math.pow(2, -p.zoom), 1e-7);
    let cr = p.cre;
    let ci = p.cim;
    if (p.morph >= 1) {
      const th = time * p.speed;
      cr = 0.7885 * Math.cos(th);
      ci = 0.7885 * Math.sin(th);
    }
    fillEscapeTime(out, cols, rows, aspect, 0, 0, span, Math.round(p.maxIter), cr, ci);
  },
  toCode: (p) =>
    planarCode(
      `// Julia escape-time density: z ↦ z² + c for a fixed complex c
const maxIter = ${Math.round(p.maxIter)};
const cr = ${F(p.cre)}, ci = ${F(p.cim)};
let zr = u, zi = v, i = 0;
while (i < maxIter && zr * zr + zi * zi <= 64) {
  const nextR = zr * zr - zi * zi + cr;
  zi = 2 * zr * zi + ci;
  zr = nextR;
  i++;
}
if (i >= maxIter) return 0.08; // inside the set: darkest char
const logzn = log(zr * zr + zi * zi) / 2;
const nu = log(logzn / LN2) / LN2;
const s = (i + 1 - nu) / maxIter;
return min(1, pow(max(0, min(1, s)), 0.42) * 1.3);`,
      Math.max(3.6 * Math.pow(2, -p.zoom), 1e-7),
      "Julia Set",
    ),
};

const seedSpec = { key: "seed", label: "seed", min: 0, max: 9999, step: 1, def: 42, int: true };

// ---------------------------------------------------------------------------
// Burning Ship — escape-time over z ↦ (|Re z| + i|Im z|)² + c, viewed around
// the classic −1.75 hull. Same smooth-color math as Mandelbrot/Julia.
// ---------------------------------------------------------------------------

export const burningShip: Shape = {
  id: "burningship",
  name: "Burning Ship",
  category: "Fractals",
  description:
    "Escape-time density of z ↦ (|Re z| + i|Im z|)² + c — burning antenna masts on the ship's hull. Zoom in toward −1.75.",
  animated: false,
  params: [
    { key: "zoom", label: "zoom", min: 0, max: 12, step: 0.1, def: 0 },
    { key: "cx", label: "center x", min: -2, max: 0.6, step: 0.005, def: -1.75 },
    { key: "cy", label: "center y", min: -1, max: 1, step: 0.005, def: 0 },
    { key: "maxIter", label: "max iterations", min: 20, max: 500, step: 10, def: 120, int: true },
  ],
  planar: (p, _time, cols, rows, aspect, out) => {
    const span = Math.max(3.4 * Math.pow(2, -p.zoom), 1e-7);
    const hspan = (span * rows * aspect) / cols;
    const maxIter = Math.round(p.maxIter);
    const li = Math.log(2);
    for (let row = 0; row < rows; row++) {
      const ci = p.cy + ((row + 0.5) / rows - 0.5) * hspan * 2;
      for (let col = 0; col < cols; col++) {
        const cr = p.cx + ((col + 0.5) / cols - 0.5) * span * 2;
        let zr = 0,
          zi = 0,
          zr2 = 0,
          zi2 = 0,
          i = 0;
        while (i < maxIter && zr2 + zi2 <= 64) {
          const nextR = zr2 - zi2 + cr;
          zi = 2 * Math.abs(zr * zi) + ci;
          zr = nextR;
          zr2 = zr * zr;
          zi2 = zi * zi;
          i++;
        }
        const base = row * cols + col;
        if (i >= maxIter) {
          out[base] = 0.08;
          continue;
        }
        const logzn = Math.log(zr2 + zi2) / 2;
        const nu = Math.log(logzn / li) / li;
        const s = (i + 1 - nu) / maxIter;
        out[base] = Math.min(1, Math.pow(Math.max(0, Math.min(1, s)), 0.45) * 1.3);
      }
    }
  },
  toCode: (p) =>
    planarCode(
      `// Burning Ship escape-time density: z -> (|Re z| + i|Im z|)^2 + c
const maxIter = ${Math.round(p.maxIter)};
const cr = ${F(p.cx)} + u, ci = ${F(p.cy)} + v;
let zr = 0, zi = 0, i = 0;
while (i < maxIter && zr * zr + zi * zi <= 64) {
  const nextR = zr * zr - zi * zi + cr;
  zi = 2 * abs(zr * zi) + ci;
  zr = nextR;
  i++;
}
if (i >= maxIter) return 0.08; // inside the ship: darkest char
const logzn = log(zr * zr + zi * zi) / 2;
const nu = log(logzn / LN2) / LN2;
const s = (i + 1 - nu) / maxIter;
return min(1, pow(max(0, min(1, s)), 0.45) * 1.3);`,
      Math.max(3.4 * Math.pow(2, -p.zoom), 1e-7),
      "Burning Ship",
    ),
};

// ---------------------------------------------------------------------------
// Barnsley fern — iterated function system (4 affine maps at 1/85/7/7 %),
// emitted as an emissive cloud. Seeded via mulberry32 so a given seed always
// grows the same frond.
// ---------------------------------------------------------------------------

function fernNext(rng: () => number, x: number, y: number): [number, number] {
  const r = rng();
  if (r < 0.01) return [0, 0.16 * y];
  if (r < 0.86) return [0.85 * x + 0.04 * y, -0.04 * x + 0.85 * y + 1.6];
  if (r < 0.93) return [0.2 * x - 0.26 * y, 0.23 * x + 0.22 * y + 1.6];
  return [-0.15 * x + 0.28 * y, 0.26 * x + 0.24 * y + 0.44];
}

// TODO: Needs better mathematical representation
export const barnsleyFern: Shape = {
  id: "barnsley",
  name: "Barnsley Fern",
  category: "Fractals",
  description:
    "The IFS classic: four affine maps chosen by 1/85/7/7 % dice rolls grow the black spleenwort frond. Deterministic for a fixed seed.",
  animated: false,
  params: [
    {
      key: "points",
      label: "point budget",
      min: 2000,
      max: 60000,
      step: 1000,
      def: 24000,
      int: true,
    },
    { key: "lum", label: "brightness", min: 0.25, max: 1, step: 0.05, def: 0.75 },
    seedSpec,
  ],
  generate: (p, _time, out) => {
    const rng = mulberry32(Math.round(p.seed) * 1013904223 + 1);
    let x = 0,
      y = 0;
    out.mode = "emissive";
    out.depthTint = false;
    const n = clamp(Math.round(p.points), 2000, 60000);
    const l = clamp01(p.lum);
    for (let i = 0; i < 20; i++) [x, y] = fernNext(rng, x, y); // settle on the attractor
    for (let i = 0; i < n; i++) {
      [x, y] = fernNext(rng, x, y);
      // y ∈ [0, 10] along the frond; shade tips brighter, center at origin
      const shade = clamp01(0.25 + 0.75 * (y / 10));
      frameGlow(out, x / 2.6, (y - 5) / 5.2, 0, l * (0.45 + 0.55 * shade));
    }
  },
  toCode: (p) =>
    generateCode(
      `// Barnsley fern IFS: 4 affine maps, probabilities 1% / 85% / 7% / 7%
const n = ${Math.round(p.points)}, lum = ${F(p.lum)};
// mulberry32 — the exact PRNG the native shape uses, so a seed grows the same frond
let a = ${Math.round(p.seed) * 1013904223 + 1} >>> 0;
const rand = () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = imul(a ^ (a >>> 15), 1 | a);
  t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let x = 0, y = 0;
for (let w = 0; w < 20; w++) rand(); // settle on the attractor
for (let i = 0; i < n; i++) {
  const r = rand();
  let nx, ny;
  if (r < 0.01) { nx = 0; ny = 0.16 * y; }
  else if (r < 0.86) { nx = 0.85 * x + 0.04 * y; ny = -0.04 * x + 0.85 * y + 1.6; }
  else if (r < 0.93) { nx = 0.2 * x - 0.26 * y; ny = 0.23 * x + 0.22 * y + 1.6; }
  else { nx = -0.15 * x + 0.28 * y; ny = 0.26 * x + 0.24 * y + 0.44; }
  x = nx; y = ny;
  const shade = min(1, 0.25 + 0.75 * (y / 10));
  glow(x / 2.6, (y - 5) / 5.2, 0, lum * (0.45 + 0.55 * shade));
}`,
      "Barnsley Fern",
    ),
};
