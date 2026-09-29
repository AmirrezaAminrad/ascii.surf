import { TAU } from "./math";
import type { SurfaceDef } from "./types";

export const PRESETS: SurfaceDef[] = [
  {
    id: "torus",
    name: "Torus",
    kind: "parametric",
    category: "Surfaces",
    code: `const R = 1.0, r = 0.45;
return [
  (R + r*cos(v)) * cos(u),
  (R + r*cos(v)) * sin(u),
  r * sin(v)
];`,
    uRange: [0, TAU],
    vRange: [0, TAU],
    scale: 1.1,
    description: "The classic donut. (R + r·cos v)·(cos u, sin u), r·sin v",
  },
  {
    id: "sphere",
    name: "Sphere",
    kind: "parametric",
    category: "Surfaces",
    code: `return [
  cos(u) * sin(v),
  sin(u) * sin(v),
  cos(v)
];`,
    uRange: [0, TAU],
    vRange: [0, Math.PI],
    scale: 1.4,
    description: "Unit sphere in spherical coordinates.",
  },
  {
    id: "sincos",
    name: "sin·cos",
    kind: "height",
    category: "Surfaces",
    code: `0.5 * sin(2*x) * cos(2*y)`,
    uRange: [-2.2, 2.2],
    vRange: [-2.2, 2.2],
    scale: 0.65,
    description: "Egg-crate surface z = sin(2x)·cos(2y)/2.",
  },
  {
    id: "mobius",
    name: "Möbius",
    kind: "parametric",
    category: "Surfaces",
    code: `const w = v; // v in [-0.4, 0.4]
return [
  (1 + w*cos(u/2)) * cos(u),
  (1 + w*cos(u/2)) * sin(u),
  w * sin(u/2)
];`,
    uRange: [0, TAU],
    vRange: [-0.4, 0.4],
    scale: 1.2,
    description: "One-sided Möbius strip.",
  },
  {
    id: "klein",
    name: "Klein Bottle",
    kind: "parametric",
    category: "Surfaces",
    code: `// Figure-8 immersion of the Klein bottle
const r = 0.5;
return [
  (1 + r*cos(u/2)*sin(v) - r*sin(u/2)*sin(2*v)) * cos(u),
  (1 + r*cos(u/2)*sin(v) - r*sin(u/2)*sin(2*v)) * sin(u),
  r*sin(u/2)*sin(v) + r*cos(u/2)*sin(2*v)
];`,
    uRange: [0, TAU],
    vRange: [0, TAU],
    scale: 1.05,
    description: "Figure-8 immersion of the non-orientable Klein bottle.",
  },
  {
    id: "trefoil",
    name: "Trefoil Knot",
    kind: "parametric",
    category: "Knots",
    code: `// tube around a trefoil knot
const a = u, r = 0.22;
const cx = sin(a) + 2*sin(2*a);
const cy = cos(a) - 2*cos(2*a);
const cz = -sin(3*a);
// tangent
const tx = cos(a) + 4*cos(2*a), ty = -sin(a) + 4*sin(2*a), tz = -3*cos(3*a);
const tl = hypot(tx, ty, tz);
const Tx = tx/tl, Ty = ty/tl, Tz = tz/tl;
// arbitrary normal via cross with up
let Nx = Ty*1 - Tz*0, Ny = Tz*0 - Tx*1, Nz = Tx*0 - Ty*0;
const nl = hypot(Nx, Ny, Nz) || 1; Nx/=nl; Ny/=nl; Nz/=nl;
const Bx = Ty*Nz - Tz*Ny, By = Tz*Nx - Tx*Nz, Bz = Tx*Ny - Ty*Nx;
return [
  (cx + r*(cos(v)*Nx + sin(v)*Bx)) / 3,
  (cy + r*(cos(v)*Ny + sin(v)*By)) / 3,
  (cz + r*(cos(v)*Nz + sin(v)*Bz)) / 3
];`,
    uRange: [0, TAU],
    vRange: [0, TAU],
    scale: 1.3,
    description: "A tube swept along the (2,3) torus knot.",
  },
  {
    id: "seashell",
    name: "Seashell",
    kind: "parametric",
    category: "Surfaces",
    code: `const a = 0.2 + 0.8 * (v / (2*PI));
return [
  a * cos(2*v) * (1 + cos(u)) * 0.9,
  a * sin(2*v) * (1 + cos(u)) * 0.9,
  a * sin(u) * 0.9 + 1.4 * (v / (2*PI)) - 0.8
];`,
    uRange: [0, TAU],
    vRange: [0, TAU],
    scale: 1.0,
    description: "Logarithmic spiral shell.",
  },
  {
    id: "heart",
    name: "Heart",
    kind: "parametric",
    category: "Surfaces",
    code: `// v: polar angle, u: azimuth
const s = sin(v);
const x = s * cos(u), y = s * sin(u), z = cos(v);
// squish sphere into a heart
return [
  x * 0.9,
  y * 0.55,
  z*0.9 + 0.5 * abs(x) - 0.2 * y*y
];`,
    uRange: [0, TAU],
    vRange: [0, Math.PI],
    scale: 1.25,
    description: "A deformed sphere.",
  },
  {
    id: "gauss",
    name: "Gaussian",
    kind: "height",
    category: "Surfaces",
    code: `1.4 * exp(-(x*x + y*y) * 1.2) - 0.5`,
    uRange: [-2, 2],
    vRange: [-2, 2],
    scale: 0.8,
    description: "Bell curve z = 1.4·e^(−1.2r²).",
  },
  {
    id: "monkey",
    name: "Monkey Saddle",
    kind: "height",
    category: "Surfaces",
    code: `0.35 * (x**3 - 3*x*y*y)`,
    uRange: [-1.4, 1.4],
    vRange: [-1.4, 1.4],
    scale: 1.0,
    description: "z = x³ − 3xy² — a saddle with room for a tail.",
  },
  {
    id: "wavepool",
    name: "Wave Pool ⟲",
    kind: "height",
    category: "Simulations",
    code: `// t is time in seconds — this surface animates
sin(3 * sqrt(x*x + y*y) - 3*t) / (1 + 0.5 * (x*x + y*y))`,
    uRange: [-2, 2],
    vRange: [-2, 2],
    scale: 0.75,
    description: "Animated ripple: a damped wave traveling outward in time.",
  },
  {
    id: "plasma",
    name: "Plasma ⟲",
    kind: "height",
    category: "Simulations",
    code: `// classic demoscene plasma, drifting with t
0.45 * (sin(2*x + t) + sin(2*y - 1.3*t) + sin(1.5*(x + y) + 0.7*t)) / 3
  + 0.2 * sin(sqrt(x*x + y*y) * 3 - t)`,
    uRange: [-2.5, 2.5],
    vRange: [-2.5, 2.5],
    scale: 0.6,
    description: "Interfering sine bands drifting over a radial wave.",
  },
  {
    id: "breathing",
    name: "Breathing Torus ⟲",
    kind: "parametric",
    category: "Simulations",
    code: `// tube radius pulses with t
const R = 1.0, r = 0.35 + 0.15 * sin(2*t);
return [
  (R + r*cos(v)) * cos(u),
  (R + r*cos(v)) * sin(u),
  r * sin(v)
];`,
    uRange: [0, TAU],
    vRange: [0, TAU],
    scale: 1.1,
    description: "A torus whose tube swells and shrinks over time.",
  },
];

/**
 * Editable shader presets (kind: "planar") — one function per screen cell.
 * Kept out of PRESETS: the legacy 13 must stay the first registry entries so
 * keyboard shortcuts 1–9 and v1 saved states keep working unchanged.
 */
export const SHADER_PRESETS: SurfaceDef[] = [
  {
    id: "shader-tunnel",
    name: "Tunnel ⟲",
    kind: "planar",
    category: "Shaders",
    code: `// classic demoscene tunnel — sin/atan2/hypot/log are in scope
const r = hypot(u, v) + 1e-4;
const a = atan2(v, u);
const depth = 10 * log(r) - 2.5 * t;
const glow = 0.5 + 0.5 * sin(depth + 5 * sin(a * 3 + t * 0.7));
return glow * exp(-0.4 * r);`,
    span: 5,
    description: "Per-cell log-polar tunnel — the shader kind's hello world.",
  },
  {
    id: "mouse-julia",
    name: "Mouse Julia ⟲",
    kind: "planar",
    category: "Shaders",
    code: `// Julia set whose seed c follows the mouse — scroll to zoom
const cr = -0.4 + mx * 0.9, ci = 0.5 + my * 0.9;
let zr = u * 1.2, zi = v * 1.2;
for (let i = 0; i < 32; i++) {
  const t2 = zr * zr - zi * zi + cr;
  zi = 2 * zr * zi + ci;
  zr = t2;
  if (zr * zr + zi * zi > 16) return i / 32;
}
return 0.85; // inside the set`,
    span: 4,
    description: "Escape-time Julia with the seed glued to your pointer.",
  },
  {
    id: "ascii-ink",
    name: "Ink Trails ⟲",
    kind: "planar",
    category: "Shaders",
    code: `// feedback ink — prev(u, v) reads the LAST frame's luminance
const d = hypot(u - mx, v - my);
const splat = exp(-d * d * 30);
const smear = prev(u * 1.02, v * 1.02); // outward drift = feedback zoom
return min(1, splat + smear * 0.96);`,
    span: 4,
    description: "Frame-feedback ink that smears and blooms wherever you point.",
  },
  {
    id: "raymarch-torus",
    name: "Raymarch Torus ⟲",
    kind: "planar",
    category: "Shaders",
    code: `// sphere-traced torus — a real 3D scene, one character cell at a time
const cs = cos(t * 0.6), sn = sin(t * 0.6);
// sdf of a torus (R=1, r=0.42) tumbling around the y axis
const sd = (px, py, pz) => {
  const x = px * cs - pz * sn, z = px * sn + pz * cs;
  return hypot(hypot(x, py) - 1, z) - 0.42;
};
let dx = u * 0.62, dy = v * 0.62, dz = 1;
const dl = hypot(dx, dy, dz);
dx /= dl; dy /= dl; dz /= dl;
let dist = 0;
for (let i = 0; i < 64; i++) {
  const px = dx * dist, py = dy * dist, pz = -2.4 + dz * dist;
  const d = sd(px, py, pz);
  if (d < 0.01) {
    // normal from the sdf gradient (torus frame), rotated back to world
    const e = 0.02;
    let nx = sd(px + e, py, pz) - sd(px - e, py, pz);
    let ny = sd(px, py + e, pz) - sd(px, py - e, pz);
    let nz = sd(px, py, pz + e) - sd(px, py, pz - e);
    const nl = hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
    const lam = max(0, wx * 0.5 + ny * 0.65 - wz * 0.55);
    return max(0.07, 0.12 + 0.88 * lam - dist * 0.05);
  }
  dist += d;
  if (dist > 5) break;
}
return NaN; // sky stays empty`,
    span: 4,
    description: "Per-cell raymarched torus with sdf lighting — shaders can do 3D too.",
  },
];

export const CHARSETS: { name: string; chars: string }[] = [
  { name: "Classic", chars: ".,-~:;=!*#$@" },
  {
    name: "Dense",
    chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  { name: "Blocks", chars: "░▒▓█" },
  { name: "Dots", chars: "·∙•●" },
  { name: "Binary", chars: "01" },
  { name: "Shade", chars: " .:-=+*#%@" },
  { name: "Math", chars: "·-+×÷=≠≈∞∑∫∂∇" },
];
