import { fmtNum, makeTube, TAU } from "../math";
import { paramCode, type Shape, type Vec3 } from "../types";

const F = fmtNum;

const tubeParam = {
  key: "tube",
  label: "tube radius",
  min: 0.08,
  max: 0.45,
  step: 0.01,
  def: 0.18,
};

/** (p,q) torus knot curve, s ∈ [0,1] → R³, roughly within radius 1.5. */
function torusKnotCurve(p: number, q: number): (s: number) => Vec3 {
  return (s) => {
    const f = s * TAU;
    const rr = 2 + Math.cos(q * f);
    return [rr * Math.cos(p * f) * 0.5, Math.sin(q * f) * 0.55, rr * Math.sin(p * f) * 0.5];
  };
}

export const torusKnot: Shape = {
  id: "torusknot",
  name: "Torus Knot (p,q)",
  category: "Knots",
  description:
    "A tube swept along the general (p,q) torus knot — the trefoil is the (2,3) case. Try p=2,q=5 for the cinquefoil.",
  animated: false,
  params: [
    { key: "p", label: "p (windings)", min: 1, max: 9, step: 1, def: 2, int: true },
    { key: "q", label: "q (wraps)", min: 1, max: 13, step: 1, def: 3, int: true },
    tubeParam,
  ],
  parametric: (p) => ({
    fn: makeTube(torusKnotCurve(p.p, p.q), () => p.tube),
    uRange: [0, 1],
    vRange: [0, TAU],
    scale: 0.9,
  }),
  toCode: (p) =>
    paramCode(
      `// tube around the Torus knot (trefoil is (2, 3))
const p = ${F(p.p)}, q = ${F(p.q)}, tube = ${F(p.tube)};
const f = u;
const rr = 2 + cos(q * f);
const cx = rr * cos(p * f) * 0.5;
const cy = sin(q * f) * 0.55;
const cz = rr * sin(p * f) * 0.5;
// analytic tangent of the knot curve
const dx = (-sin(p * f) * p * rr - cos(p * f) * q * sin(q * f)) * 0.5;
const dy = 0.55 * q * cos(q * f);
const dz = (cos(p * f) * p * rr - sin(p * f) * q * sin(q * f)) * 0.5;
const tl = hypot(dx, dy, dz) || 1;
const Tx = dx / tl, Ty = dy / tl, Tz = dz / tl;
let Nx = Ty, Ny = -Tx, Nz = 0; // T x up(0, 0, 1)
const nl = hypot(Nx, Ny, Nz) || 1;
Nx /= nl; Ny /= nl; Nz /= nl;
const Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
const cv = cos(v), sv = sin(v);
return [
  cx + tube * (cv * Nx + sv * Bx),
  cy + tube * (cv * Ny + sv * By),
  cz + tube * (cv * Nz + sv * Bz)
];`,
      [0, TAU],
      [0, TAU],
      0.9,
      "Torus Knot",
    ),
};

// Figure-eight knot: the standard (2 + cos 2t)·(cos 3t, sin 3t) embedding,
// lifted by sin 4t. Not a torus knot — it is the (2,3) twist knot with
// crossing number 4, the simplest knot after the trefoil.
export const figureEight: Shape = {
  id: "figure8",
  name: "Figure-Eight Knot",
  category: "Knots",
  description:
    "The (2,3) twist knot — crossing number 4, the only prime knot simpler than the trefoil's family. Standard embedding, tunable tube.",
  animated: false,
  params: [tubeParam],
  parametric: (p) => ({
    fn: makeTube(
      (s) => {
        const t = s * TAU;
        const c2 = 2 + Math.cos(2 * t);
        return [c2 * Math.cos(3 * t) * 0.42, Math.sin(4 * t) * 0.5, c2 * Math.sin(3 * t) * 0.42];
      },
      () => p.tube,
    ),
    uRange: [0, 1],
    vRange: [0, TAU],
    scale: 0.95,
  }),
  toCode: (p) =>
    paramCode(
      `// tube around the figure-eight knot: (2 + cos 2t)(cos 3t, sin 3t), lifted by sin 4t
const tube = ${F(p.tube)};
const f = u;
const c2 = 2 + cos(2 * f);
const cx = c2 * cos(3 * f) * 0.42;
const cy = sin(4 * f) * 0.5;
const cz = c2 * sin(3 * f) * 0.42;
const dx = -2 * sin(2 * f) * cos(3 * f) * 0.42 - c2 * 3 * sin(3 * f) * 0.42;
const dy = 4 * cos(4 * f) * 0.5;
const dz = -2 * sin(2 * f) * sin(3 * f) * 0.42 + c2 * 3 * cos(3 * f) * 0.42;
const tl = hypot(dx, dy, dz) || 1;
const Tx = dx / tl, Ty = dy / tl, Tz = dz / tl;
let Nx = Ty, Ny = -Tx, Nz = 0; // T x up(0, 0, 1)
const nl = hypot(Nx, Ny, Nz) || 1;
Nx /= nl; Ny /= nl; Nz /= nl;
const Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
const cv = cos(v), sv = sin(v);
return [
  cx + tube * (cv * Nx + sv * Bx),
  cy + tube * (cv * Ny + sv * By),
  cz + tube * (cv * Nz + sv * Bz)
];`,
      [0, TAU],
      [0, TAU],
      0.95,
      "Figure-Eight Knot",
    ),
};

export const cinquefoil: Shape = {
  id: "cinquefoil",
  name: "Cinquefoil (2,5)",
  category: "Knots",
  description:
    "The (2,5) torus knot — five crossings, Solomon's seal knot. A preset of the general (p,q) knot, still fully adjustable.",
  animated: false,
  params: [
    { key: "p", label: "p (windings)", min: 1, max: 9, step: 1, def: 2, int: true },
    { key: "q", label: "q (wraps)", min: 1, max: 13, step: 1, def: 5, int: true },
    { key: "tube", label: "tube radius", min: 0.08, max: 0.45, step: 0.01, def: 0.15 },
  ],
  parametric: (p) => ({
    fn: makeTube(torusKnotCurve(p.p, p.q), () => p.tube),
    uRange: [0, 1],
    vRange: [0, TAU],
    scale: 0.9,
  }),
  toCode: (p) =>
    paramCode(
      `// tube around the Cinquefoil knot (2, 5)
const p = ${F(p.p)}, q = ${F(p.q)}, tube = ${F(p.tube)};
const f = u;
const rr = 2 + cos(q * f);
const cx = rr * cos(p * f) * 0.5;
const cy = sin(q * f) * 0.55;
const cz = rr * sin(p * f) * 0.5;
// analytic tangent of the knot curve
const dx = (-sin(p * f) * p * rr - cos(p * f) * q * sin(q * f)) * 0.5;
const dy = 0.55 * q * cos(q * f);
const dz = (cos(p * f) * p * rr - sin(p * f) * q * sin(q * f)) * 0.5;
const tl = hypot(dx, dy, dz) || 1;
const Tx = dx / tl, Ty = dy / tl, Tz = dz / tl;
let Nx = Ty, Ny = -Tx, Nz = 0; // T x up(0, 0, 1)
const nl = hypot(Nx, Ny, Nz) || 1;
Nx /= nl; Ny /= nl; Nz /= nl;
const Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
const cv = cos(v), sv = sin(v);
return [
  cx + tube * (cv * Nx + sv * Bx),
  cy + tube * (cv * Ny + sv * By),
  cz + tube * (cv * Nz + sv * Bz)
];`,
      [0, TAU],
      [0, TAU],
      0.9,
      "Cinquefoil Knot",
    ),
};

// Lissajous knot: x = cos(nx·t + φx), y = cos(ny·t + φy), z = cos(nz·t) with
// pairwise-coprime frequencies and phase offsets — a knot iff no frequency
// pair shares a common factor > 1 (for nz odd). The (3,2,7) default is the
// classic "billiard knot".
export const lissajous: Shape = {
  id: "lissajous",
  name: "Lissajous Knot",
  category: "Knots",
  description:
    "A 3D Lissajous figure: cos of three coprime frequencies with phase shifts. Try (3,2,7), or bump the phase to untie it.",
  animated: false,
  params: [
    { key: "nx", label: "freq x", min: 1, max: 11, step: 1, def: 3, int: true },
    { key: "ny", label: "freq y", min: 1, max: 11, step: 1, def: 2, int: true },
    { key: "nz", label: "freq z", min: 1, max: 11, step: 1, def: 7, int: true },
    { key: "phase", label: "phase (rad)", min: 0, max: 1.5, step: 0.01, def: 0.7 },
    tubeParam,
  ],
  parametric: (p) => ({
    fn: makeTube(
      (s) => {
        const t = s * TAU;
        return [
          Math.cos(p.nx * t + p.phase) * 0.85,
          Math.cos(p.ny * t + 0.5 * p.phase) * 0.85,
          Math.cos(p.nz * t) * 0.85,
        ];
      },
      () => p.tube,
    ),
    uRange: [0, 1],
    vRange: [0, TAU],
    scale: 1,
  }),
  toCode: (p) =>
    paramCode(
      `// tube around the Lissajous knot (cos of coprime frequencies + phase shifts)
const nx = ${Math.round(p.nx)}, ny = ${Math.round(p.ny)}, nz = ${Math.round(p.nz)};
const ph = ${F(p.phase)}, tube = ${F(p.tube)};
const f = u;
const cx = cos(nx * f + ph) * 0.85;
const cy = cos(ny * f + ph / 2) * 0.85;
const cz = cos(nz * f) * 0.85;
// analytic tangent
const dx = -sin(nx * f + ph) * nx * 0.85;
const dy = -sin(ny * f + ph / 2) * ny * 0.85;
const dz = -sin(nz * f) * nz * 0.85;
const tl = hypot(dx, dy, dz) || 1;
const Tx = dx / tl, Ty = dy / tl, Tz = dz / tl;
let Nx = Ty, Ny = -Tx, Nz = 0; // T x up(0, 0, 1)
const nl = hypot(Nx, Ny, Nz) || 1;
Nx /= nl; Ny /= nl; Nz /= nl;
const Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
const cv = cos(v), sv = sin(v);
return [
  cx + tube * (cv * Nx + sv * Bx),
  cy + tube * (cv * Ny + sv * By),
  cz + tube * (cv * Nz + sv * Bz)
];`,
      [0, TAU],
      [0, TAU],
      1,
      "Lissajous Knot",
    ),
};
