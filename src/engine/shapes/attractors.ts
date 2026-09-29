/**
 * Strange attractors & fiber bundles: Clifford + Peter de Jong 2D maps emitted
 * as emissive clouds (flat in z, like the Barnsley fern), and the Hopf
 * fibration — Villarceau-circle fibers of S³ stereographically projected into
 * nested tori. All static, so the renderer caches the geometry.
 */
import { clamp, clamp01, fmtNum } from "../math";
import { generateCode, frameGlow, type Shape } from "../types";

const F = fmtNum;

// ---------------------------------------------------------------------------
// Clifford attractor — x' = sin(a·y) + c·cos(a·x), y' = sin(b·x) + d·cos(b·y).
// Extent stays within |x| ≤ 1+|c|, |y| ≤ 1+|d|; the shared scale below frames
// typical parameters while letting extreme dials overflow gracefully (zoom out).
// ---------------------------------------------------------------------------

/** Shared normalization for both attractors: ~1.0 at the classic dials. */
function attractorScale(bx: number, by: number): number {
  return 1.4 / (1 + 0.4 * Math.max(Math.abs(bx), Math.abs(by)));
}

function emitClifford(
  a: number,
  b: number,
  c: number,
  d: number,
  n: number,
  lum: number,
  out: Parameters<typeof frameGlow>[0],
): void {
  const s = attractorScale(c, d);
  let x = 0.1,
    y = 0.3;
  for (let i = 0; i < 64; i++) {
    x = Math.sin(a * y) + c * Math.cos(a * x);
    y = Math.sin(b * x) + d * Math.cos(b * y); // settle
  }
  for (let i = 0; i < n; i++) {
    const px = x,
      py = y;
    x = Math.sin(a * y) + c * Math.cos(a * x);
    y = Math.sin(b * x) + d * Math.cos(b * y);
    // trajectory speed shades the cloud: fast stretches of the orbit glow bright
    const speed = Math.min(1, Math.abs(x - px) + Math.abs(y - py));
    frameGlow(out, x * s, y * s, 0, lum * (0.5 + 0.5 * speed));
  }
}

const attractorLum = { key: "lum", label: "brightness", min: 0.25, max: 1, step: 0.05, def: 0.8 };
const pointsParam = {
  key: "points",
  label: "point budget",
  min: 10000,
  max: 150000,
  step: 10000,
  def: 60000,
  int: true,
};
const attractorParams = (a: number, b: number, c: number, d: number) => [
  { key: "a", label: "a", min: -3, max: 3, step: 0.05, def: a },
  { key: "b", label: "b", min: -3, max: 3, step: 0.05, def: b },
  { key: "c", label: "c", min: -3, max: 3, step: 0.05, def: c },
  { key: "d", label: "d", min: -3, max: 3, step: 0.05, def: d },
  pointsParam,
  attractorLum,
];

// TODO: Needs better mathematical representation
export const clifford: Shape = {
  id: "clifford",
  name: "Clifford Attractor",
  category: "Fractals",
  description:
    "Clifford's strange attractor: x′ = sin(a·y) + c·cos(a·x), y′ = sin(b·x) + d·cos(b·y). Four dials, endless dust structures — orbit speed sets the brightness.",
  animated: false,
  params: attractorParams(-1.4, 1.6, 1.0, 0.7),
  generate: (p, _time, out) => {
    out.mode = "emissive";
    out.depthTint = false;
    const n = clamp(Math.round(p.points), pointsParam.min, pointsParam.max);
    emitClifford(p.a, p.b, p.c, p.d, n, clamp01(p.lum), out);
  },
  toCode: (p) =>
    generateCode(
      `// Clifford attractor: x' = sin(a*y) + c*cos(a*x), y' = sin(b*x) + d*cos(b*y)
const a = ${F(p.a)}, b = ${F(p.b)}, c = ${F(p.c)}, d = ${F(p.d)};
const n = ${Math.round(p.points)}, lum = ${F(p.lum)};
const s = 1.4 / (1 + 0.4 * max(abs(c), abs(d)));
let x = 0.1, y = 0.3;
for (let w = 0; w < 64; w++) { x = sin(a*y) + c*cos(a*x); y = sin(b*x) + d*cos(b*y); }
for (let i = 0; i < n; i++) {
  const px = x, py = y;
  x = sin(a*y) + c*cos(a*x);
  y = sin(b*x) + d*cos(b*y);
  const speed = min(1, abs(x - px) + abs(y - py));
  glow(x * s, y * s, 0, lum * (0.5 + 0.5 * speed));
}`,
      "Clifford Attractor",
    ),
};

// ---------------------------------------------------------------------------
// Peter de Jong attractor — x' = sin(a·y) − cos(b·x), y' = sin(c·x) − cos(d·y).
// ---------------------------------------------------------------------------

function emitDeJong(
  a: number,
  b: number,
  c: number,
  d: number,
  n: number,
  lum: number,
  out: Parameters<typeof frameGlow>[0],
): void {
  // de Jong's extent is dial-independent — each axis is a sin−cos pair, always
  // bounded by ±2 — so unlike Clifford's (c, d) this is not a bound: it is a
  // framing heuristic that keeps the classic dials at Clifford's visual scale.
  const s = attractorScale(b, d);
  let x = 0.15,
    y = 0.25;
  for (let i = 0; i < 64; i++) {
    x = Math.sin(a * y) - Math.cos(b * x);
    y = Math.sin(c * x) - Math.cos(d * y); // settle
  }
  for (let i = 0; i < n; i++) {
    const px = x,
      py = y;
    x = Math.sin(a * y) - Math.cos(b * x);
    y = Math.sin(c * x) - Math.cos(d * y);
    const speed = Math.min(1, Math.abs(x - px) + Math.abs(y - py));
    frameGlow(out, x * s, y * s, 0, lum * (0.5 + 0.5 * speed));
  }
}

// TODO: Needs better mathematical representation
export const dejong: Shape = {
  id: "dejong",
  name: "De Jong Attractor",
  category: "Fractals",
  description:
    "Peter de Jong's map: x′ = sin(a·y) − cos(b·x), y′ = sin(c·x) − cos(d·y). The classic ±2.1 dials yield lens-and-eye nebulae; brightness follows orbit speed.",
  animated: false,
  params: attractorParams(1.4, -2.3, 2.4, -2.1),
  generate: (p, _time, out) => {
    out.mode = "emissive";
    out.depthTint = false;
    const n = clamp(Math.round(p.points), pointsParam.min, pointsParam.max);
    emitDeJong(p.a, p.b, p.c, p.d, n, clamp01(p.lum), out);
  },
  toCode: (p) =>
    generateCode(
      `// Peter de Jong attractor: x' = sin(a*y) - cos(b*x), y' = sin(c*x) - cos(d*y)
const a = ${F(p.a)}, b = ${F(p.b)}, c = ${F(p.c)}, d = ${F(p.d)};
const n = ${Math.round(p.points)}, lum = ${F(p.lum)};
const s = 1.4 / (1 + 0.4 * max(abs(b), abs(d)));
let x = 0.15, y = 0.25;
for (let w = 0; w < 64; w++) { x = sin(a*y) - cos(b*x); y = sin(c*x) - cos(d*y); }
for (let i = 0; i < n; i++) {
  const px = x, py = y;
  x = sin(a*y) - cos(b*x);
  y = sin(c*x) - cos(d*y);
  const speed = min(1, abs(x - px) + abs(y - py));
  glow(x * s, y * s, 0, lum * (0.5 + 0.5 * speed));
}`,
      "De Jong Attractor",
    ),
};

// ---------------------------------------------------------------------------
// Hopf fibration — one Villarceau circle per base point of S². A fiber through
// base (a, b) ∈ C² (|a|²+|b|²=1) is (a·e^{it}, b·e^{it}); stereographic
// projection from (0,0,0,1) maps S³ → R³ as (x1, y1, x2)/(1 − y2). Base points
// ride a Fibonacci spiral over the whole sphere, so the fibers weave the
// classic nested-torus bouquet.
// ---------------------------------------------------------------------------

const fibersParam = {
  key: "fibers",
  label: "fiber count",
  min: 6,
  max: 96,
  step: 1,
  def: 26,
  int: true,
};
const densityParam = {
  key: "density",
  label: "points per fiber",
  min: 20,
  max: 140,
  step: 2,
  def: 110,
  int: true,
};

// TODO: Needs better mathematical representation
export const hopf: Shape = {
  id: "hopf",
  name: "Hopf Fibration",
  category: "Knots",
  description:
    "Every point of S² owns a circle in S³; stereographically projected they nest into linked tori with no two circles intersecting. Base points ride a Fibonacci spiral.",
  animated: false,
  params: [
    fibersParam,
    densityParam,
    { key: "lum", label: "brightness", min: 0.25, max: 1, step: 0.05, def: 0.85 },
  ],
  generate: (p, _time, out) => {
    out.mode = "emissive";
    out.depthTint = true;
    const fibers = clamp(Math.round(p.fibers), fibersParam.min, fibersParam.max);
    const density = clamp(Math.round(p.density), densityParam.min, densityParam.max);
    const lum = clamp01(p.lum);
    const s = 0.82; // the stereo-projected bouquet spans ~±2 — pull it into frame
    const ga = Math.PI * (3 - Math.sqrt(5)); // golden-angle spiral over S²
    for (let k = 0; k < fibers; k++) {
      // base point on S²: polar η from the spiral, azimuth ξ from the golden angle
      const eta = Math.acos(1 - (2 * (k + 0.5)) / fibers);
      const xi = ga * k;
      const a = Math.cos(eta / 2); // |a|² + |b|² = 1
      const b = Math.sin(eta / 2);
      const ar = a * Math.cos(xi),
        ai = a * Math.sin(xi);
      const br = b * Math.cos(xi),
        bi = b * Math.sin(xi);
      // shading: latitude of the base point adds tonal variety between fibers
      const shade = 0.45 + 0.55 * (eta / Math.PI);
      for (let j = 0; j < density; j++) {
        const t = (j / density) * 2 * Math.PI;
        const ct = Math.cos(t),
          st = Math.sin(t);
        const x1 = ar * ct - ai * st; // (a·e^{it}) re / im
        const y1 = ar * st + ai * ct;
        const x2 = br * ct - bi * st;
        const y2 = br * st + bi * ct;
        const w = 1 - y2;
        if (Math.abs(w) < 1e-4) continue; // the projection point itself
        frameGlow(out, (x1 * s) / w, (y1 * s) / w, (x2 * s) / w, lum * shade);
      }
    }
  },
  toCode: (p) =>
    generateCode(
      `// Hopf fibration: fiber (a·e^{it}, b·e^{it}) for base points on S²,
// stereographically projected from (0,0,0,1): (x1, y1, x2) / (1 - y2)
const fibers = ${Math.round(p.fibers)}, n = ${Math.round(p.density)}, lum = ${F(p.lum)};
const s = 0.82, ga = PI * (3 - sqrt(5));
for (let k = 0; k < fibers; k++) {
  const eta = acos(1 - (2 * (k + 0.5)) / fibers);
  const xi = ga * k;
  const a = cos(eta / 2), b = sin(eta / 2);
  const ar = a * cos(xi), ai = a * sin(xi);
  const br = b * cos(xi), bi = b * sin(xi);
  const shade = 0.45 + 0.55 * (eta / PI);
  for (let j = 0; j < n; j++) {
    const t = (j / n) * 2 * PI;
    const ct = cos(t), st = sin(t);
    const x1 = ar * ct - ai * st, y1 = ar * st + ai * ct;
    const x2 = br * ct - bi * st, y2 = br * st + bi * ct;
    const w = 1 - y2;
    if (abs(w) < 1e-4) continue;
    glow(x1 * s / w, y1 * s / w, x2 * s / w, lum * shade);
  }
}`,
      "Hopf Fibration",
      true,
    ),
};
