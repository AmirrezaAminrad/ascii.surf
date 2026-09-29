import { fmtNum, TAU, clamp } from "../math";
import { frameGlow, framePush, implicitCode, paramCode, type Shape, type Vec3 } from "../types";

const qualityParam = { key: "quality", label: "grid quality", min: 16, max: 72, step: 2, def: 40 };

const F = fmtNum;

// ---------------------------------------------------------------------------
// Tier 1 — minimal & classic surfaces (parametric)
// ---------------------------------------------------------------------------

export const catenoid: Shape = {
  id: "catenoid",
  name: "Catenoid",
  category: "Surfaces",
  description:
    "Minimal surface of revolution: a hanging chain spun around an axis. x = c·cosh(v/c)·(cos u, sin u).",
  animated: false,
  params: [
    { key: "neck", label: "neck radius", min: 0.3, max: 1.2, step: 0.05, def: 0.7 },
    { key: "height", label: "half height", min: 0.4, max: 2, step: 0.05, def: 1.1 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const r = p.neck * Math.cosh(v / p.neck);
      return [r * Math.cos(u), v, r * Math.sin(u)];
    },
    uRange: [0, TAU],
    vRange: [-p.height, p.height],
    scale: 0.62,
  }),
  toCode: (p) =>
    paramCode(
      `const c = ${F(p.neck)};
const r = c * cosh(v / c);
return [r * cos(u), v, r * sin(u)];`,
      [0, TAU],
      [-p.height, p.height],
      0.62,
      "Catenoid",
    ),
};

export const helicoid: Shape = {
  id: "helicoid",
  name: "Helicoid",
  category: "Surfaces",
  description:
    "Minimal surface that screws its way upward — a spiral staircase. (v·cos u, v·sin u, c·u).",
  animated: false,
  params: [
    { key: "turns", label: "turns", min: 1, max: 4, step: 1, def: 2, int: true },
    { key: "pitch", label: "pitch", min: 0.3, max: 1.2, step: 0.05, def: 0.7 },
    { key: "width", label: "width", min: 0.4, max: 1.6, step: 0.05, def: 1 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const th = u * p.turns * TAU;
      return [v * Math.cos(th), p.pitch * p.turns * (u - 0.5), v * Math.sin(th)];
    },
    uRange: [0, 1],
    vRange: [-p.width, p.width],
    scale: 0.85,
  }),
  toCode: (p) =>
    paramCode(
      `const turns = ${F(p.turns)}, pitch = ${F(p.pitch)};
const th = u * turns * ${F(TAU)};
return [v * cos(th), pitch * turns * (u - 0.5), v * sin(th)];`,
      [0, 1],
      [-p.width, p.width],
      0.85,
      "Helicoid",
    ),
};

export const dini: Shape = {
  id: "dini",
  name: "Dini's Surface",
  category: "Surfaces",
  description:
    "A twisted pseudosphere — constant negative curvature curled into a spiral horn with a helical groove.",
  animated: false,
  params: [
    { key: "a", label: "radius", min: 0.6, max: 2.5, step: 0.05, def: 1.3 },
    { key: "b", label: "twist", min: 0.1, max: 0.8, step: 0.02, def: 0.32 },
    { key: "turns", label: "turns", min: 1, max: 3, step: 1, def: 2, int: true },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const sv = Math.sin(v);
      const x = p.a * Math.cos(u) * sv;
      const z = p.a * Math.sin(u) * sv;
      const y =
        (p.a * (Math.cos(v) + Math.log(Math.tan(v / 2))) + p.b * u - p.b * p.turns * Math.PI) / 1.9;
      return [x, y, z];
    },
    uRange: [0, p.turns * TAU],
    vRange: [0.35, 2.75],
    scale: 0.85,
  }),
  toCode: (p) =>
    paramCode(
      `const a = ${F(p.a)}, b = ${F(p.b)}, turns = ${F(p.turns)};
const sv = sin(v);
const x = a * cos(u) * sv;
const z = a * sin(u) * sv;
const y = (a * (cos(v) + log(tan(v / 2))) + b * u - b * turns * PI) / 1.9;
return [x, y, z];`,
      [0, p.turns * TAU],
      [0.35, 2.75],
      0.85,
      "Dini's Surface",
    ),
};

export const enneper: Shape = {
  id: "enneper",
  name: "Enneper Surface",
  category: "Surfaces",
  description: "Self-intersecting minimal surface with a characteristic three-lobed ruffle.",
  animated: false,
  params: [{ key: "spread", label: "spread", min: 0.8, max: 2, step: 0.05, def: 1.5 }],
  parametric: (p) => ({
    fn: (u, v) => [u - (u * u * u) / 3 + u * v * v, u * u - v * v, v - (v * v * v) / 3 + v * u * u],
    uRange: [-p.spread, p.spread],
    vRange: [-p.spread, p.spread],
    scale: 0.4,
  }),
  toCode: (p) =>
    paramCode(
      `// u, v range is [-${F(p.spread)}, ${F(p.spread)}]\nreturn [u - u ** 3 / 3 + u * v * v, u * u - v * v, v - v ** 3 / 3 + v * u * u];`,
      [-p.spread, p.spread],
      [-p.spread, p.spread],
      0.4,
      "Enneper Surface",
    ),
};

export const hyperParaboloid: Shape = {
  id: "hyparaboloid",
  name: "Hyperb. Paraboloid",
  category: "Surfaces",
  description:
    "The Pringle: z = a·x² − b·y². Negative curvature everywhere — crank the specular light to see it.",
  animated: false,
  params: [
    { key: "a", label: "curvature x", min: 0.3, max: 1.5, step: 0.05, def: 0.7 },
    { key: "b", label: "curvature y", min: 0.3, max: 1.5, step: 0.05, def: 0.7 },
  ],
  parametric: (p) => ({
    fn: (u, v) => [u, p.a * u * u - p.b * v * v, v],
    uRange: [-1.5, 1.5],
    vRange: [-1.5, 1.5],
    scale: 0.62,
  }),
  toCode: (p) =>
    paramCode(
      `const a = ${F(p.a)}, b = ${F(p.b)};\nreturn [u, a * u * u - b * v * v, v];`,
      [-1.5, 1.5],
      [-1.5, 1.5],
      0.62,
      "Hyperbolic Paraboloid",
    ),
};

export const hyperboloid: Shape = {
  id: "hyperboloid",
  name: "Hyperboloid",
  category: "Surfaces",
  description:
    "One sheet (a cooling tower ruled by straight lines) or two sheets — set the sheets parameter.",
  animated: false,
  params: [
    { key: "sheets", label: "sheets (1|2)", min: 1, max: 2, step: 1, def: 1, int: true },
    { key: "a", label: "waist radius", min: 0.4, max: 1.4, step: 0.05, def: 0.7 },
    { key: "c", label: "height scale", min: 0.4, max: 2, step: 0.05, def: 1 },
    { key: "t", label: "extent", min: 0.5, max: 1.6, step: 0.05, def: 1 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const ch = Math.cosh(v);
      if (p.sheets >= 2) {
        // duplicate the u domain: second turn is the lower sheet
        const sgn = u < TAU ? 1 : -1;
        const uu = u % TAU;
        return [p.a * ch * Math.cos(uu), sgn * p.c * Math.sinh(v), p.a * ch * Math.sin(uu)];
      }
      return [p.a * ch * Math.cos(u), p.c * Math.sinh(v), p.a * ch * Math.sin(u)];
    },
    uRange: p.sheets >= 2 ? [0, 2 * TAU] : [0, TAU],
    vRange: p.sheets >= 2 ? [0.3, p.t + 0.3] : [-p.t, p.t],
    scale: 0.85,
  }),
  toCode: (p) =>
    paramCode(
      `const a = ${F(p.a)}, c = ${F(p.c)}, two = ${p.sheets >= 2 ? "true" : "false"};
const ch = cosh(v);
if (two) {
  const sgn = u < ${F(TAU)} ? 1 : -1;
  const uu = u % ${F(TAU)};
  return [a * ch * cos(uu), sgn * c * sinh(v), a * ch * sin(uu)];
}
return [a * ch * cos(u), c * sinh(v), a * ch * sin(u)];`,
      p.sheets >= 2 ? [0, 2 * TAU] : [0, TAU],
      p.sheets >= 2 ? [0.3, p.t + 0.3] : [-p.t, p.t],
      0.85,
      "Hyperboloid",
    ),
};

// ---------------------------------------------------------------------------
// Tier 2 — non-orientable & triply periodic (Boy, Roman, Gyroid, Schwarz P)
// ---------------------------------------------------------------------------

// Boy's surface, Bryant–Kusner parametrization: w = r·e^{iθ} in the unit disk,
// g = (−3/2·Im[w(1−w⁴)/D], −3/2·Re[w(1+w⁴)/D], Im[(1+w⁶)/D] − 1/2),
// D = w⁶ + √5·w³ − 1, normalized by 1/|g|². Antipodal points of the disk rim
// are identified, so the parameter boundary closes seamlessly.
export const boys: Shape = {
  id: "boys",
  name: "Boy's Surface",
  category: "Surfaces",
  description:
    "Immersion of the real projective plane — non-orientable, smooth everywhere, one triple point. Bryant–Kusner parametrization.",
  animated: false,
  params: [],
  parametric: () => ({
    fn: (u, v) => {
      const r = v;
      const th = u;
      const c1 = r * Math.cos(th);
      const s1 = r * Math.sin(th);
      const r3 = r * r * r;
      const c3 = r3 * Math.cos(3 * th);
      const s3 = r3 * Math.sin(3 * th);
      const r5 = r3 * r * r;
      const c5 = r5 * Math.cos(5 * th);
      const s5 = r5 * Math.sin(5 * th);
      const r6 = r3 * r3;
      const c6 = r6 * Math.cos(6 * th);
      const s6 = r6 * Math.sin(6 * th);
      const SQRT5 = 2.23606797749979;
      const dr = c6 + SQRT5 * c3 - 1;
      const di = s6 + SQRT5 * s3;
      const dd = dr * dr + di * di || 1e-30;
      const a1r = c1 - c5;
      const a1i = s1 - s5;
      const g1 = (-1.5 * (a1i * dr - a1r * di)) / dd;
      const b1r = c1 + c5;
      const b1i = s1 + s5;
      const g2 = (-1.5 * (b1r * dr + b1i * di)) / dd;
      const m3r = 1 + c6;
      const m3i = s6;
      const g3 = (m3i * dr - m3r * di) / dd - 0.5;
      const n = g1 * g1 + g2 * g2 + g3 * g3 || 1e-30;
      return [g1 / n, g3 / n, g2 / n];
    },
    uRange: [0, TAU],
    vRange: [0, 1],
    scale: 0.42,
  }),
  toCode: () =>
    paramCode(
      `// Boy's surface — Bryant–Kusner parametrization (w = r·e^{iθ}, r ≤ 1)
const r = v, th = u;
const SQRT5 = 2.23606797749979;
const c1 = r * cos(th), s1 = r * sin(th);
const r3 = r * r * r, c3 = r3 * cos(3 * th), s3 = r3 * sin(3 * th);
const r5 = r3 * r * r, c5 = r5 * cos(5 * th), s5 = r5 * sin(5 * th);
const r6 = r3 * r3, c6 = r6 * cos(6 * th), s6 = r6 * sin(6 * th);
const dr = c6 + SQRT5 * c3 - 1, di = s6 + SQRT5 * s3;
const dd = dr * dr + di * di || 1e-30;
const g1 = (-1.5 * ((s1 - s5) * dr - (c1 - c5) * di)) / dd;
const g2 = (-1.5 * ((c1 + c5) * dr + (s1 + s5) * di)) / dd;
const g3 = ((s6 * dr - (1 + c6) * di) / dd) - 0.5;
const n = g1 * g1 + g2 * g2 + g3 * g3 || 1e-30;
return [g1 / n, g3 / n, g2 / n];`,
      [0, TAU],
      [0, 1],
      0.42,
      "Boy's Surface",
    ),
};

// Roman (Steiner) surface: image of the sphere under (X,Y,Z) → (YZ, ZX, XY).
// The coordinate planes pierce it as double lines meeting at a triple point.
export const roman: Shape = {
  id: "roman",
  name: "Roman Surface",
  category: "Surfaces",
  description:
    "Steiner's self-intersecting immersion of RP²: x²y²+y²z²+z²x² = xyz, drawn from the sphere map (X,Y,Z)→(YZ,ZX,XY).",
  animated: false,
  params: [],
  parametric: () => ({
    fn: (u, v) => {
      const X = Math.sin(v) * Math.cos(u);
      const Y = Math.sin(v) * Math.sin(u);
      const Z = Math.cos(v);
      return [2 * Y * Z, 2 * Z * X, 2 * X * Y];
    },
    uRange: [0, TAU],
    vRange: [0, Math.PI],
    scale: 1.1,
  }),
  toCode: () =>
    paramCode(
      `// image of the sphere under (X, Y, Z) → (YZ, ZX, XY), scaled ×2
const X = sin(v) * cos(u), Y = sin(v) * sin(u), Z = cos(v);
return [2 * Y * Z, 2 * Z * X, 2 * X * Y];`,
      [0, TAU],
      [0, Math.PI],
      1.1,
      "Roman Surface",
    ),
};

export const gyroid: Shape = {
  id: "gyroid",
  name: "Gyroid",
  category: "Surfaces",
  description:
    "Triply periodic minimal surface: sin x·cos y + sin y·cos z + sin z·cos x = 0 — a bounded section of the infinite foam.",
  animated: false,
  params: [
    { key: "freq", label: "frequency", min: 1, max: 6, step: 0.1, def: 3.3 },
    { key: "iso", label: "level shift", min: -0.5, max: 0.5, step: 0.02, def: 0 },
    { key: "bound", label: "section size", min: 0.6, max: 2, step: 0.05, def: 1.15 },
    qualityParam,
  ],
  implicit: (p) => ({
    f: (x, y, z) => {
      const k = p.freq;
      return (
        Math.sin(k * x) * Math.cos(k * y) +
        Math.sin(k * y) * Math.cos(k * z) +
        Math.sin(k * z) * Math.cos(k * x) -
        p.iso
      );
    },
    bound: p.bound,
    iso: 0,
  }),
  toCode: (p) =>
    implicitCode(
      `const k = ${F(p.freq)};\nreturn sin(k * x) * cos(k * y) + sin(k * y) * cos(k * z) + sin(k * z) * cos(k * x) - ${F(p.iso)};`,
      p.bound,
      0,
      "Gyroid",
    ),
};

export const schwarzP: Shape = {
  id: "schwarzp",
  name: "Schwarz P",
  category: "Surfaces",
  description:
    "Schwarz's Primitive surface: cos x + cos y + cos z = P — a triply periodic minimal surface splitting space into two labyrinths.",
  animated: false,
  params: [
    { key: "freq", label: "frequency", min: 1, max: 6, step: 0.1, def: 3.3 },
    { key: "P", label: "level P", min: -0.8, max: 0.8, step: 0.02, def: 0 },
    { key: "bound", label: "section size", min: 0.6, max: 2, step: 0.05, def: 1.15 },
    qualityParam,
  ],
  implicit: (p) => ({
    f: (x, y, z) => {
      const k = p.freq;
      return Math.cos(k * x) + Math.cos(k * y) + Math.cos(k * z) - p.P;
    },
    bound: p.bound,
    iso: 0,
  }),
  toCode: (p) =>
    implicitCode(
      `const k = ${F(p.freq)};\nreturn cos(k * x) + cos(k * y) + cos(k * z) - ${F(p.P)};`,
      p.bound,
      0,
      "Schwarz P",
    ),
};

// ---------------------------------------------------------------------------
// Tier 3 — Klein quartic embedding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Klein quartic: real locus of X³Y + Y³Z + Z³X = 0 in RP², lifted to the unit
// sphere and swept as tubes. This is a 3D visualization of the quartic rather
// than the genus-3 complex curve itself (whose tightest embedding lives in
// hyperbolic space, not R³).
// ---------------------------------------------------------------------------

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Trace the real quartic on the unit sphere; returns closed polylines of 3D points. */
function kleinLoops(): Vec3[][] {
  // fixed rotation so the sphere poles are generic points (they lie on the raw curve)
  const rx = 0.7,
    ry = 0.4,
    rz = 0.2;
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  const rot = (p: Vec3): Vec3 => {
    let [x, y, z] = p;
    const y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    y = y1;
    z = z1;
    const x1 = x * cy + z * sy;
    z1 = -x * sy + z * cy;
    x = x1;
    return [x * cz - y * sz, x * sz + y * cz, z1];
  };
  const F = (p: Vec3): number => {
    const [X, Y, Z] = rot(p);
    return X * X * X * Y + Y * Y * Y * Z + Z * Z * Z * X;
  };
  const GT = 220;
  const GP = 140;
  const vals = new Float64Array(GT * GP);
  const theta = new Float64Array(GT);
  const sth = new Float64Array(GT);
  const cth = new Float64Array(GT);
  for (let i = 0; i < GT; i++) {
    theta[i] = (i / GT) * TAU;
    sth[i] = Math.sin(theta[i]);
    cth[i] = Math.cos(theta[i]);
  }
  for (let i = 0; i < GT; i++) {
    for (let j = 0; j < GP; j++) {
      const ph = ((j + 0.5) / GP) * Math.PI;
      const sp = Math.sin(ph);
      vals[i * GP + j] = F([sp * cth[i], Math.cos(ph), sp * sth[i]]);
    }
  }
  const spt = (i: number, j: number): Vec3 => {
    const ph = ((j + 0.5) / GP) * Math.PI;
    const sp = Math.sin(ph);
    return [sp * cth[((i % GT) + GT) % GT], Math.cos(ph), sp * sth[((i % GT) + GT) % GT]];
  };
  const at = (i: number, j: number) => vals[(((i % GT) + GT) % GT) * GP + clamp(j, 0, GP - 1)];

  // marching squares with θ periodic; crossing points are keyed by grid edge
  const pointPos = new Map<string, Vec3>();
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  const edgePt = (key: string, a: Vec3, b: Vec3, fa: number, fb: number): string => {
    let p = pointPos.get(key);
    if (!p) {
      const d = fa - fb;
      const t = Math.abs(d) < 1e-15 ? 0.5 : fa / d;
      p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      pointPos.set(key, p);
    }
    return key;
  };
  for (let i = 0; i < GT; i++) {
    for (let j = 0; j < GP - 1; j++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v01 = at(i, j + 1);
      const v11 = at(i + 1, j + 1);
      const s00 = v00 >= 0,
        s10 = v10 >= 0,
        s01 = v01 >= 0,
        s11 = v11 >= 0;
      if (s00 === s10 && s10 === s01 && s01 === s11) continue;
      const p00 = spt(i, j);
      const p10 = spt(i + 1, j);
      const p01 = spt(i, j + 1);
      const p11 = spt(i + 1, j + 1);
      const eh = `h${i}:${j}`;
      const eh1 = `h${i}:${j + 1}`;
      const ev = `v${i}:${j}`;
      const ev1 = `v${i + 1}:${j}`;
      const pts: string[] = [];
      if (s00 !== s10) pts.push(edgePt(eh, p00, p10, v00, v10));
      if (s00 !== s01) pts.push(edgePt(ev, p00, p01, v00, v01));
      if (s10 !== s11) pts.push(edgePt(ev1, p10, p11, v10, v11));
      if (s01 !== s11) pts.push(edgePt(eh1, p01, p11, v01, v11));
      // 2 crossings: one segment; 4 (ambiguous saddle): pair arbitrarily
      for (let k = 0; k + 1 < pts.length; k += 2) link(pts[k], pts[k + 1]);
    }
  }

  // walk adjacency chains into loops (each crossing key touches exactly 2 links)
  const visited = new Set<string>();
  const loops: Vec3[][] = [];
  for (const [start] of adj) {
    if (visited.has(start)) continue;
    const loop: Vec3[] = [];
    let cur = start;
    let prev = "";
    let guard = 0;
    while (guard++ < 200000) {
      visited.add(cur);
      loop.push(pointPos.get(cur)!);
      const nexts = adj.get(cur) ?? [];
      let next = "";
      for (const n of nexts) {
        if (n !== prev && !visited.has(n)) {
          next = n;
          break;
        }
      }
      if (!next || next === start) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  return loops;
}

export const kleinQuartic: Shape = {
  id: "kleinquartic",
  name: "Klein Quartic",
  category: "Surfaces",
  description:
    "Real locus of x³y + y³z + z³x = 0 lifted to the sphere and swept as tubes — a 3D view of the genus-3 quartic (its minimal embedding lives in hyperbolic space).",
  animated: false,
  params: [{ key: "tube", label: "tube radius", min: 0.04, max: 0.22, step: 0.01, def: 0.1 }],
  generate: (p, _time, out) => {
    const loops = kleinLoops();
    for (const loop of loops) {
      // arc-length resample: clean [0,1] curve for the tube builder
      const n = loop.length;
      const cum = new Float64Array(n + 1);
      for (let i = 0; i < n; i++)
        cum[i + 1] = cum[i] + Math.sqrt(dist2(loop[(i + 1) % n], loop[i]));
      const total = cum[n];
      if (total < 0.05) continue;
      const M = clamp(Math.round(total * 140), 120, 2400);
      const curveAt = (s: number): Vec3 => {
        const target = clamp(s, 0, 0.9999) * total;
        let lo = 0;
        let hi = n;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] <= target) lo = mid;
          else hi = mid;
        }
        const segLen = cum[lo + 1] - cum[lo] || 1;
        const t = (target - cum[lo]) / segLen;
        const a = loop[lo % n];
        const b = loop[(lo + 1) % n];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      };
      // sweep with an explicitly transported frame: re-projecting the normal
      // against the tangent every step keeps the cross-section round. (makeTube
      // only resyncs on steps > 5e-3, and this sweep steps by 1/M — far below
      // it — so its frame drifts and the tube goes elliptical.)
      const pts: Vec3[] = new Array(M);
      const tans: Vec3[] = new Array(M);
      for (let i = 0; i < M; i++) pts[i] = curveAt(i / M);
      for (let i = 0; i < M; i++) {
        const a = pts[(i - 1 + M) % M];
        const b = pts[(i + 1) % M];
        const tx = b[0] - a[0],
          ty = b[1] - a[1],
          tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tans[i] = [tx / tl, ty / tl, tz / tl];
      }
      let nx: number, ny: number, nz: number;
      {
        // seed the transported normal from T × up (T × ŷ when T is near-vertical)
        const t = tans[0];
        const rx = 0,
          ry = Math.abs(t[2]) > 0.9 ? 1 : 0,
          rz = Math.abs(t[2]) > 0.9 ? 0 : 1;
        nx = t[1] * rz - t[2] * ry;
        ny = t[2] * rx - t[0] * rz;
        nz = t[0] * ry - t[1] * rx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      const sv = 8;
      const r = p.tube;
      for (let i = 0; i < M; i++) {
        const t = tans[i];
        const d = nx * t[0] + ny * t[1] + nz * t[2];
        nx -= d * t[0];
        ny -= d * t[1];
        nz -= d * t[2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const bx = t[1] * nz - t[2] * ny;
        const by = t[2] * nx - t[0] * nz;
        const bz = t[0] * ny - t[1] * nx;
        const c = pts[i];
        for (let j = 0; j < sv; j++) {
          const ph = (j / sv) * TAU;
          const cv = Math.cos(ph),
            psv = Math.sin(ph);
          const qx = c[0] + r * (cv * nx + psv * bx);
          const qy = c[1] + r * (cv * ny + psv * by);
          const qz = c[2] + r * (cv * nz + psv * bz);
          framePush(
            out,
            qx * 1.1,
            qy * 1.1,
            qz * 1.1,
            (qx - c[0]) / r,
            (qy - c[1]) / r,
            (qz - c[2]) / r,
          );
        }
      }
    }
    if (out.count === 0) {
      // degenerate fallback: a bright ring so the shape never renders empty
      for (let i = 0; i < 400; i++) {
        const a = (i / 400) * TAU;
        frameGlow(out, Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2, 0.8);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Superquadric — spherical product of two superellipses (|cos|^{ε2}-style
// exponents). ε = 1 recovers a sphere; ε < 1 rounds toward a cube, ε > 1
// pinches toward an octahedron. Sign symmetries keep the normals outward.
// ---------------------------------------------------------------------------

function sqSignPow(q: number, e: number): number {
  const s = q < 0 ? -1 : 1;
  return s * Math.pow(Math.abs(q), e);
}

export const superquadric: Shape = {
  id: "superquadric",
  name: "Superquadric",
  category: "Surfaces",
  description:
    "The spherical product of two superellipses — morphs from sphere to rounded box to star with the ε1/ε2 exponents. Barr, 1981.",
  animated: false,
  params: [
    { key: "e1", label: "ε1 (latitude)", min: 0.2, max: 2.5, step: 0.05, def: 0.35 },
    { key: "e2", label: "ε2 (longitude)", min: 0.2, max: 2.5, step: 0.05, def: 0.35 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      // u ∈ [−π/2, π/2] latitude, v ∈ [−π, π] longitude
      const cu = Math.cos(u),
        su = Math.sin(u);
      const cv = Math.cos(v),
        sv = Math.sin(v);
      const e1 = clamp(p.e1, 0.1, 3),
        e2 = clamp(p.e2, 0.1, 3);
      return [
        sqSignPow(cu, e1) * sqSignPow(cv, e2),
        sqSignPow(su, e1),
        sqSignPow(cu, e1) * sqSignPow(sv, e2),
      ];
    },
    uRange: [-Math.PI / 2, Math.PI / 2],
    vRange: [-Math.PI, Math.PI],
    scale: 1,
  }),
  toCode: (p) =>
    paramCode(
      `// superquadric: |cos u|^e1-sign product of two superellipses
const e1 = ${F(p.e1)}, e2 = ${F(p.e2)};
const sp = (q, e) => (q < 0 ? -1 : 1) * pow(abs(q), e);
const cu = cos(u), su = sin(u), cv = cos(v), sv = sin(v);
return [
  sp(cu, e1) * sp(cv, e2),
  sp(su, e1),
  sp(cu, e1) * sp(sv, e2)
];`,
      [-Math.PI / 2, Math.PI / 2],
      [-Math.PI, Math.PI],
      1,
      "Superquadric",
    ),
};

// ---------------------------------------------------------------------------
// Spherical harmonic + supershape (parametric)
// ---------------------------------------------------------------------------

/** Associated Legendre P_l^m(x), unnormalized (m ≥ 0, computed by upward recurrence). */
function legendreP(l: number, m: number, x: number): number {
  let pmm = 1; // P_m^m seed
  if (m > 0) {
    const somx2 = Math.sqrt(Math.max(0, 1 - x * x));
    let fact = 1;
    for (let i = 1; i <= m; i++) {
      pmm *= -fact * somx2;
      fact += 2;
    }
  }
  if (l === m) return pmm;
  let pmmp1 = x * (2 * m + 1) * pmm; // P_{m+1}^m
  if (l === m + 1) return pmmp1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmmp1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmmp1;
    pmmp1 = pll;
  }
  return pll;
}

/** Real spherical harmonic Y_l^m(θ, φ), L2-normalized so |Y| stays in a sane band. */
function sphericalHarmonic(l: number, m: number, theta: number, phi: number): number {
  const x = Math.cos(theta);
  const p = legendreP(l, m, x);
  const k = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - m) / factorial(l + m)));
  return k * p * (m === 0 ? 1 : Math.cos(m * phi) * Math.SQRT2);
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

export const sphericalHarmonicShape: Shape = {
  id: "spherical-harmonic",
  name: "Spherical Harmonic",
  category: "Surfaces",
  description:
    "Radius graph r = Y_l^m(θ, φ) of the real spherical harmonics — the orbitals behind atomic structure. The morph slider folds the |Y| clover into its signed balloon.",
  animated: false,
  params: [
    { key: "l", label: "degree ℓ", min: 0, max: 8, step: 1, def: 3, int: true },
    { key: "m", label: "order m", min: 0, max: 8, step: 1, def: 2, int: true },
    { key: "morph", label: "morph ±/|Y|", min: 0, max: 1, step: 0.01, def: 0 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const l = clamp(Math.round(p.l), 0, 8);
      const m = Math.min(clamp(Math.round(p.m), 0, 8), l);
      const y = sphericalHarmonic(l, m, u, v);
      const morph = clamp(p.morph, 0, 1);
      const r = clamp((1 - morph) * Math.abs(y) + morph * (0.72 + 0.55 * y), 0.02, 2.4);
      const st = Math.sin(u),
        ct = Math.cos(u);
      return [r * st * Math.cos(v), r * ct, r * st * Math.sin(v)];
    },
    uRange: [0, Math.PI], // θ
    vRange: [0, TAU], // φ
    scale: 1.35,
  }),
  toCode: (p) => {
    const l = clamp(Math.round(p.l), 0, 8);
    const m = Math.min(clamp(Math.round(p.m), 0, 8), l);
    const morph = clamp(p.morph, 0, 1);
    return paramCode(
      `// spherical harmonic Y_${l},${m} — real, L2-normalized
const l = ${l}, m = ${m}, morph = ${F(morph)};
function legendre(l, m, x) {
  let pmm = 1;
  if (m > 0) {
    const s = sqrt(max(0, 1 - x * x));
    let fact = 1;
    for (let i = 1; i <= m; i++) { pmm *= -fact * s; fact += 2; }
  }
  if (l === m) return pmm;
  let pmmp1 = x * (2 * m + 1) * pmm, pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmmp1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmmp1; pmmp1 = pll;
  }
  return pll;
}
function fact(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
const y = sqrt((2*l+1) / (4*pi) * fact(l - m) / fact(l + m))
        * legendre(l, m, cos(u)) * (m === 0 ? 1 : cos(m * v) * 1.4142);
const r = min(max((1 - morph) * abs(y) + morph * (0.72 + 0.55 * y), 0.02), 2.4);
const st = sin(u), ct = cos(u);
return [r * st * cos(v), r * ct, r * st * sin(v)];`,
      [0, Math.PI],
      [0, TAU],
      1.35,
      "Spherical Harmonic",
    );
  },
};

/** Gielis superformula r(φ) = (|cos(mφ/4)/a|^n2 + |sin(mφ/4)/b|^n3)^(−1/n1). */
function superformula(angle: number, m: number, n1: number, n2: number, n3: number): number {
  const t = (m * angle) / 4;
  const a = Math.pow(Math.abs(Math.cos(t)), n2);
  const b = Math.pow(Math.abs(Math.sin(t)), n3);
  const d = Math.pow(a + b, -1 / Math.max(0.05, n1));
  return Number.isFinite(d) ? clamp(d, 0, 3) : 0;
}

export const supershape: Shape = {
  id: "supershape",
  name: "Supershape",
  category: "Surfaces",
  description:
    "The 3D superformula (Gielis, 2003): two superformula profiles swept into one surface — flowers, stars, shells and crystals from five sliders.",
  animated: false,
  params: [
    { key: "m1", label: "m₁ (θ lobes)", min: 0, max: 20, step: 0.5, def: 7 },
    { key: "m2", label: "m₂ (φ lobes)", min: 0, max: 20, step: 0.5, def: 3 },
    { key: "n1", label: "n₁ (pinch)", min: 0.1, max: 5, step: 0.05, def: 0.4 },
    { key: "n2", label: "n₂", min: 0.1, max: 10, step: 0.05, def: 1.7 },
    { key: "n3", label: "n₃", min: 0.1, max: 10, step: 0.05, def: 1.7 },
  ],
  parametric: (p) => ({
    fn: (u, v) => {
      const n1 = clamp(p.n1, 0.05, 8),
        n2 = clamp(p.n2, 0.05, 12),
        n3 = clamp(p.n3, 0.05, 12);
      const r1 = superformula(u, clamp(p.m1, 0, 24), n1, n2, n3);
      const r2 = superformula(v, clamp(p.m2, 0, 24), n1, n2, n3);
      const cu = Math.cos(u),
        su = Math.sin(u);
      return [r1 * cu * r2 * Math.cos(v), r1 * su, r1 * cu * r2 * Math.sin(v)];
    },
    uRange: [-Math.PI / 2, Math.PI / 2], // θ
    vRange: [-Math.PI, Math.PI], // φ
    scale: 1.15,
  }),
  toCode: (p) =>
    paramCode(
      `// supershape: spherical product of two Gielis superformula profiles
const m1 = ${F(p.m1)}, m2 = ${F(p.m2)}, n1 = ${F(p.n1)}, n2 = ${F(p.n2)}, n3 = ${F(p.n3)};
const sf = (a, m) => {
  const t = (m * a) / 4;
  const d = pow(pow(abs(cos(t)), n2) + pow(abs(sin(t)), n3), -1 / max(0.05, n1));
  return isFinite(d) ? min(max(d, 0), 3) : 0;
};
const r1 = sf(u, m1), r2 = sf(v, m2);
const cu = cos(u), su = sin(u);
return [r1 * cu * r2 * cos(v), r1 * su, r1 * cu * r2 * sin(v)];`,
      [-Math.PI / 2, Math.PI / 2],
      [-Math.PI, Math.PI],
      1.15,
      "Supershape",
    ),
};
