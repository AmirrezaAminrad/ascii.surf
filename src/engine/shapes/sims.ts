import { TAU, clamp, clamp01, fmtNum, makeNoise3, makeRk4, mulberry32 } from "../math";
import { frameGlow, implicitCode, paramCode, simCode, type Shape, type Sim } from "../types";

const F = fmtNum;

const seedSpec = { key: "seed", label: "seed", min: 0, max: 9999, step: 1, def: 42, int: true };
const qualitySpec = { key: "quality", label: "grid quality", min: 20, max: 56, step: 2, def: 44 };

// ---------------------------------------------------------------------------
// Metaballs — moving implicit spheres, field f = Σ r²/d², animated merge/split
// rendered through the renderer's implicit level-set path.
// ---------------------------------------------------------------------------

export const metaballs: Shape = {
  id: "metaballs",
  name: "Metaballs ⟲",
  category: "Simulations",
  description:
    "Implicit spheres blending on Lissajous orbits — watch them merge and split as the field crosses its isosurface.",
  animated: true,
  params: [
    { key: "count", label: "ball count", min: 1, max: 8, step: 1, def: 5, int: true },
    { key: "iso", label: "iso level", min: 1, max: 6, step: 0.1, def: 4 },
    { key: "speed", label: "speed", min: 0, max: 3, step: 0.05, def: 1 },
    { key: "spread", label: "spread", min: 0.2, max: 1.4, step: 0.05, def: 0.6 },
    qualitySpec,
  ],
  implicit: (p) => {
    const n = clamp(Math.round(p.count), 1, 8);
    const sp = p.speed;
    const phase = new Float64Array(n);
    const rad = new Float64Array(n);
    const skip2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963; // golden angle
      phase[i] = a;
      rad[i] = 0.45 + 0.12 * Math.sin(a * 5.1);
      // broad phase: a ball whose contribution r²/d² is under 0.2% of the iso
      // level can't move the level set — skip it past this squared distance
      skip2[i] = (rad[i] * rad[i]) / (0.002 * p.iso);
    }
    // centers depend only on t — memoize them once per frame instead of
    // re-running the trig for every one of the ~69k grid samples
    const bx = new Float64Array(n);
    const by = new Float64Array(n);
    const bz = new Float64Array(n);
    let bt = NaN;
    const placeBalls = (t: number) => {
      if (t === bt) return;
      bt = t;
      for (let i = 0; i < n; i++) {
        const a = phase[i];
        bx[i] = p.spread * Math.sin(t * 0.7 * sp + a) * Math.cos(t * 0.31 * sp + a * 1.7);
        by[i] = p.spread * 0.7 * Math.sin(t * 0.43 * sp + a * 3.1);
        bz[i] = p.spread * Math.sin(t * 0.53 * sp + a * 2.3) * Math.cos(t * 0.23 * sp + a);
      }
    };
    return {
      f: (x, y, z, t) => {
        placeBalls(t);
        let f = 0;
        for (let i = 0; i < n; i++) {
          const dx = x - bx[i];
          const dy = y - by[i];
          const dz = z - bz[i];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > skip2[i]) continue;
          f += (rad[i] * rad[i]) / (d2 + 0.012);
        }
        return f - p.iso;
      },
      bound: Math.min(2.2, p.spread + 0.75),
      iso: 0,
    };
  },
  toCode: (p) =>
    implicitCode(
      `// moving metaballs: f = sum of r^2/d^2, surface where f crosses the iso level
const sp = ${F(p.speed)};
let f = 0;
for (let i = 0; i < ${F(p.count)}; i++) {
  const a = i * 2.399963;
  const r = 0.45 + 0.12 * sin(a * 5.1);
  const bx = ${F(p.spread)} * sin(t * 0.7 * sp + a) * cos(t * 0.31 * sp + a * 1.7);
  const by = ${F(p.spread)} * 0.7 * sin(t * 0.43 * sp + a * 3.1);
  const bz = ${F(p.spread)} * sin(t * 0.53 * sp + a * 2.3) * cos(t * 0.23 * sp + a);
  const q = (x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2 + 0.012;
  f += (r * r) / q;
}
return f - ${F(p.iso)};`,
      Math.min(2.2, p.spread + 0.75),
      0,
      "Metaballs",
    ),
};

// ---------------------------------------------------------------------------
// Ripple interference — moving point sources on a height field; superposition
// gives constructive/destructive interference.
// ---------------------------------------------------------------------------

export const rippleInterference: Shape = {
  id: "rippleint",
  name: "Ripple Interference ⟲",
  category: "Simulations",
  description:
    "Independently drifting wave sources superpose on a damped sheet — interference fringes crawl as the sources move.",
  animated: true,
  params: [
    { key: "sources", label: "sources", min: 1, max: 8, step: 1, def: 3, int: true },
    { key: "freq", label: "frequency", min: 1, max: 12, step: 0.5, def: 6 },
    { key: "speed", label: "wave speed", min: 0, max: 12, step: 0.25, def: 5 },
    { key: "decay", label: "decay", min: 0, max: 4, step: 0.1, def: 1.2 },
  ],
  parametric: (p) => {
    const n = clamp(Math.round(p.sources), 1, 8);
    const norm = Math.pow(n, 0.55);
    return {
      fn: (u, v, t) => {
        let z = 0;
        for (let i = 0; i < n; i++) {
          const a = i * 2.399963;
          const sx = 1.3 * Math.sin(t * 0.21 + a) * Math.cos(t * 0.13 + a * 2);
          const sy = 1.3 * Math.sin(t * 0.17 + a * 1.3) * Math.cos(t * 0.11 + a);
          const dx = u - sx;
          const dy = v - sy;
          const d = Math.sqrt(dx * dx + dy * dy);
          z += Math.sin(p.freq * d - p.speed * t) / (1 + p.decay * d * d);
        }
        z /= norm;
        return [u, z * 0.6, v];
      },
      uRange: [-2, 2],
      vRange: [-2, 2],
      scale: 0.8,
    };
  },
  toCode: (p) =>
    paramCode(
      `const n = ${Math.round(p.sources)}, k = ${F(p.freq)}, w = ${F(p.speed)}, dec = ${F(p.decay)};
let z = 0;
for (let i = 0; i < n; i++) {
  const a = i * 2.399963;
  const sx = 1.3 * sin(t * 0.21 + a) * cos(t * 0.13 + a * 2);
  const sy = 1.3 * sin(t * 0.17 + a * 1.3) * cos(t * 0.11 + a);
  const dd = hypot(u - sx, v - sy);
  z += sin(k * dd - w * t) / (1 + dec * dd * dd);
}
z /= pow(n, 0.55);
return [u, z * 0.6, v];`,
      [-2, 2],
      [-2, 2],
      0.8,
      "Ripple Interference",
    ),
};

// ---------------------------------------------------------------------------
// Double pendulum — RK4-integrated chaotic motion with rods, bobs and a trail.
// ---------------------------------------------------------------------------

export const doublePendulum: Shape = {
  id: "doublependulum",
  name: "Double Pendulum ⟲",
  category: "Simulations",
  description:
    "Physically-integrated chaos: two rods, two masses, RK4 at 240 Hz. Nudge the start angles and watch determinism diverge.",
  animated: true,
  params: [
    { key: "m1", label: "mass 1", min: 0.2, max: 3, step: 0.1, def: 1 },
    { key: "m2", label: "mass 2", min: 0.2, max: 3, step: 0.1, def: 1 },
    { key: "l1", label: "length 1", min: 0.4, max: 1.6, step: 0.05, def: 1 },
    { key: "l2", label: "length 2", min: 0.4, max: 1.6, step: 0.05, def: 1 },
    { key: "g", label: "gravity", min: 1, max: 25, step: 0.5, def: 9.81 },
    { key: "th1", label: "start θ1", min: -3.1, max: 3.1, step: 0.05, def: 2.1 },
    { key: "th2", label: "start θ2", min: -3.1, max: 3.1, step: 0.05, def: 2.6 },
    { key: "speed", label: "speed", min: 0.1, max: 3, step: 0.05, def: 1 },
    { key: "trail", label: "trail length", min: 100, max: 4000, step: 100, def: 1500, int: true },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const m1 = p.m1,
      m2 = p.m2,
      l1 = p.l1,
      l2 = p.l2,
      g = p.g;
    const rk = makeRk4(4, (y, dy) => {
      const [th1, w1, th2, w2] = y;
      const d = th1 - th2;
      const den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
      dy[0] = w1;
      dy[1] =
        (-g * (2 * m1 + m2) * Math.sin(th1) -
          m2 * g * Math.sin(th1 - 2 * th2) -
          2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) /
        (l1 * den);
      dy[2] = w2;
      dy[3] =
        (2 *
          Math.sin(d) *
          (w1 * w1 * l1 * (m1 + m2) +
            g * (m1 + m2) * Math.cos(th1) +
            w2 * w2 * l2 * m2 * Math.cos(d))) /
        (l2 * den);
    });
    const rng = mulberry32(seed);
    rk.y[0] = p.th1 + 0.001 * (rng() - 0.5);
    rk.y[1] = 0;
    rk.y[2] = p.th2 + 0.001 * (rng() - 0.5);
    rk.y[3] = 0;
    const cap = clamp(Math.round(p.trail), 100, 4000);
    const trail = new Float32Array(cap * 3);
    let head = 0;
    let len = 0;
    const sc = 0.55;
    const H = 1 / 240;
    const pushTrail = () => {
      const [th1, , th2] = rk.y;
      const x1 = l1 * Math.sin(th1);
      const y1 = -l1 * Math.cos(th1);
      trail[head * 3] = (x1 + l2 * Math.sin(th2)) * sc;
      trail[head * 3 + 1] = (y1 - l2 * Math.cos(th2)) * sc;
      trail[head * 3 + 2] = 0;
      head = (head + 1) % cap;
      if (len < cap) len++;
    };
    return {
      step(dt, _time, out) {
        const steps = clamp(Math.round((dt * p.speed) / H), 0, 240);
        for (let i = 0; i < steps; i++) {
          rk.step(H);
          if (i % 2 === 0) pushTrail();
        }
        if (steps === 0 && len === 0) pushTrail();
        // render
        out.mode = "emissive";
        out.depthTint = false;
        const th1 = rk.y[0],
          th2 = rk.y[2];
        const x1 = l1 * Math.sin(th1) * sc;
        const y1 = -l1 * Math.cos(th1) * sc;
        const x2 = x1 + l2 * Math.sin(th2) * sc;
        const y2 = y1 - l2 * Math.cos(th2) * sc;
        for (let i = 1; i <= 10; i++) {
          const t = i / 10;
          frameGlow(out, x1 * t, y1 * t, 0, 0.75);
          frameGlow(out, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0, 0.75);
        }
        for (let i = 0; i < 4; i++) frameGlow(out, x1, y1, 0, 0.95);
        for (let i = 0; i < 8; i++) frameGlow(out, x2, y2, 0, 1);
        for (let i = 0; i < len; i++) {
          const idx = (head - 1 - i + cap * 2) % cap;
          const fade = 1 - i / len;
          frameGlow(out, trail[idx * 3], trail[idx * 3 + 1], trail[idx * 3 + 2], 0.6 * fade * fade);
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// double pendulum, RK4 at 240 Hz substeps
const m1 = ${F(p.m1)}, m2 = ${F(p.m2)}, l1 = ${F(p.l1)}, l2 = ${F(p.l2)};
const g = ${F(p.g)}, speed = ${F(p.speed)}, cap = ${Math.round(p.trail)};
let th1 = ${F(p.th1)}, w1 = 0, th2 = ${F(p.th2)}, w2 = 0;
const trail = [], sc = 0.55;
const deriv = (p, d) => {
  const D = p[0] - p[2];
  const den = 2 * m1 + m2 - m2 * cos(2 * D);
  d[0] = p[1];
  d[1] = (-g * (2 * m1 + m2) * sin(p[0]) - m2 * g * sin(p[0] - 2 * p[2]) -
    2 * sin(D) * m2 * (p[3] * p[3] * l2 + p[1] * p[1] * l1 * cos(D))) / (l1 * den);
  d[2] = p[3];
  d[3] = (2 * sin(D) * (p[1] * p[1] * l1 * (m1 + m2) + g * (m1 + m2) * cos(p[0]) +
    p[3] * p[3] * l2 * m2 * cos(D))) / (l2 * den);
};
const rk4 = (h) => {
  const p = [th1, w1, th2, w2];
  const a = [0, 0, 0, 0], b = [0, 0, 0, 0], c = [0, 0, 0, 0], d = [0, 0, 0, 0], q = [0, 0, 0, 0];
  deriv(p, a);
  for (let i = 0; i < 4; i++) q[i] = p[i] + h / 2 * a[i];
  deriv(q, b);
  for (let i = 0; i < 4; i++) q[i] = p[i] + h / 2 * b[i];
  deriv(q, c);
  for (let i = 0; i < 4; i++) q[i] = p[i] + h * c[i];
  deriv(q, d);
  th1 += h / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]);
  w1 += h / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]);
  th2 += h / 6 * (a[2] + 2 * b[2] + 2 * c[2] + d[2]);
  w2 += h / 6 * (a[3] + 2 * b[3] + 2 * c[3] + d[3]);
};
return {
  step(dt) {
    const H = 1 / 240;
    const steps = Math.max(0, Math.min(240, Math.round((dt * speed) / H)));
    for (let s = 0; s < steps; s++) {
      rk4(H);
      if (s % 2 === 0) {
        trail.push([(l1 * sin(th1) + l2 * sin(th2)) * sc, (-l1 * cos(th1) - l2 * cos(th2)) * sc, 0]);
        if (trail.length > cap) trail.shift();
      }
    }
    const x1 = l1 * sin(th1) * sc, y1 = -l1 * cos(th1) * sc;
    const x2 = x1 + l2 * sin(th2) * sc, y2 = y1 - l2 * cos(th2) * sc;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      glow(x1 * t, y1 * t, 0, 0.75);
      glow(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0, 0.75);
    }
    for (let i = 0; i < 4; i++) glow(x1, y1, 0, 0.95);
    for (let i = 0; i < 8; i++) glow(x2, y2, 0, 1);
    for (let i = 0; i < trail.length; i++) {
      const q = trail[trail.length - 1 - i];
      const fade = 1 - i / trail.length;
      glow(q[0], q[1], q[2], 0.6 * fade * fade);
    }
  },
};`,
      "Double Pendulum",
    ),
};

// ---------------------------------------------------------------------------
// Lorenz attractor — σ, ρ, β integrated with RK4; the trajectory persists as a
// fading ring buffer and rotates with the view.
// ---------------------------------------------------------------------------

export const lorenz: Shape = {
  id: "lorenz",
  name: "Lorenz Attractor ⟲",
  category: "Simulations",
  description:
    "The butterfly: ẋ = σ(y−x), ẏ = x(ρ−z) − y, ż = xy − βz. The trajectory draws itself, oldest points fading first.",
  animated: true,
  params: [
    { key: "sigma", label: "σ", min: 5, max: 20, step: 0.5, def: 10 },
    { key: "rho", label: "ρ", min: 10, max: 60, step: 1, def: 28 },
    { key: "beta", label: "β", min: 1, max: 4, step: 0.05, def: 2.667 },
    { key: "speed", label: "speed", min: 0.1, max: 3, step: 0.05, def: 1 },
    { key: "trail", label: "trail length", min: 500, max: 8000, step: 500, def: 4000, int: true },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const sg = p.sigma,
      rh = p.rho,
      be = p.beta;
    const rk = makeRk4(3, (y, dy) => {
      dy[0] = sg * (y[1] - y[0]);
      dy[1] = y[0] * (rh - y[2]) - y[1];
      dy[2] = y[0] * y[1] - be * y[2];
    });
    const rng = mulberry32(seed);
    rk.y[0] = 0.6 + 0.05 * rng();
    rk.y[1] = 0.4 + 0.05 * rng();
    rk.y[2] = 20 + 2 * rng();
    const cap = clamp(Math.round(p.trail), 500, 8000);
    const trail = new Float32Array(cap * 3);
    let head = 0;
    let len = 0;
    const H = 0.004;
    const push = () => {
      trail[head * 3] = rk.y[0] / 16;
      trail[head * 3 + 1] = (rk.y[2] - 25) / 16;
      trail[head * 3 + 2] = rk.y[1] / 16;
      head = (head + 1) % cap;
      if (len < cap) len++;
    };
    return {
      step(dt, _time, out) {
        const steps = clamp(Math.round((dt * p.speed) / H), 0, 80);
        for (let i = 0; i < steps; i++) {
          rk.step(H);
          push();
        }
        out.mode = "emissive";
        out.depthTint = true;
        for (let i = 0; i < len; i++) {
          const idx = (head - 1 - i + cap * 2) % cap;
          const fade = 1 - i / len;
          frameGlow(
            out,
            trail[idx * 3],
            trail[idx * 3 + 1],
            trail[idx * 3 + 2],
            0.12 + 0.85 * fade * fade,
          );
        }
        // glowing head
        const hx = rk.y[0] / 16,
          hy = (rk.y[2] - 25) / 16,
          hz = rk.y[1] / 16;
        for (let i = 0; i < 5; i++) frameGlow(out, hx, hy, hz, 1);
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// Lorenz attractor: dx = s(y - x), dy = x(r - z) - y, dz = xy - b z
const sg = ${F(p.sigma)}, rh = ${F(p.rho)}, be = ${F(p.beta)}, speed = ${F(p.speed)}, cap = ${Math.round(p.trail)};
let x = 0.6, y = 0.4, z = 20;
const trail = [];
const f = (p) => [sg * (p[1] - p[0]), p[0] * (rh - p[2]) - p[1], p[0] * p[1] - be * p[2]];
return {
  step(dt) {
    const H = 0.004;
    const steps = Math.max(0, Math.min(80, Math.round((dt * speed) / H)));
    for (let s = 0; s < steps; s++) {
      const p = [x, y, z];
      const a = f(p);
      const b = f([p[0] + H / 2 * a[0], p[1] + H / 2 * a[1], p[2] + H / 2 * a[2]]);
      const c = f([p[0] + H / 2 * b[0], p[1] + H / 2 * b[1], p[2] + H / 2 * b[2]]);
      const d = f([p[0] + H * c[0], p[1] + H * c[1], p[2] + H * c[2]]);
      x += H / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]);
      y += H / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]);
      z += H / 6 * (a[2] + 2 * b[2] + 2 * c[2] + d[2]);
      trail.push([x / 16, (z - 25) / 16, y / 16]);
      if (trail.length > cap) trail.shift();
    }
    for (let i = 0; i < trail.length; i++) {
      const fade = 1 - i / trail.length;
      const q = trail[trail.length - 1 - i];
      glow(q[0], q[1], q[2], 0.12 + 0.85 * fade * fade);
    }
    for (let i = 0; i < 5; i++) glow(x / 16, (z - 25) / 16, y / 16, 1);
  },
};`,
      "Lorenz Attractor",
    ),
};

// ---------------------------------------------------------------------------
// Flow field — seeded particles advected through selectable vector fields,
// rendered as comet trails.
// ---------------------------------------------------------------------------

export const flowField: Shape = {
  id: "flowfield",
  name: "Flow Field ⟲",
  category: "Simulations",
  description:
    "Particles ride a vector field and leave trails: ABC flow, curl noise, or a spiral vortex. Same seed, same dance.",
  animated: true,
  params: [
    { key: "count", label: "particles", min: 50, max: 1200, step: 10, def: 420, int: true },
    { key: "field", label: "field (0|1|2)", min: 0, max: 2, step: 1, def: 0, int: true },
    { key: "speed", label: "speed", min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: "trail", label: "trail", min: 2, max: 30, step: 1, def: 12, int: true },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const N = clamp(Math.round(p.count), 10, 1200);
    const HIST = 30;
    const pos = new Float32Array(N * 3);
    const hist = new Float32Array(HIST * N * 3);
    const life = new Float32Array(N);
    const rng = mulberry32(seed);
    const noise = makeNoise3(seed * 7 + 1);
    const respawn = (i: number) => {
      // uniform-ish point in a ball of radius 2
      let x: number, y: number, z: number, l: number;
      do {
        x = rng() * 2 - 1;
        y = rng() * 2 - 1;
        z = rng() * 2 - 1;
        l = x * x + y * y + z * z;
      } while (l > 1 || l < 1e-6);
      pos[i * 3] = x * 2;
      pos[i * 3 + 1] = y * 2;
      pos[i * 3 + 2] = z * 2;
      life[i] = 3 + rng() * 7;
    };
    for (let i = 0; i < N; i++) respawn(i);
    let frame = 0;
    const fieldAt = (x: number, y: number, z: number, out3: Float64Array, t: number) => {
      const mode = clamp(Math.round(p.field), 0, 2);
      if (mode === 0) {
        // ABC flow
        out3[0] = Math.sin(z) + Math.cos(y);
        out3[1] = Math.sin(x) + Math.cos(z);
        out3[2] = Math.sin(y) + Math.cos(x);
      } else if (mode === 1) {
        // curl of seeded vector noise
        const e = 0.18;
        const A = (ax: number, ay: number, az: number, k: number) =>
          noise(ax + k * 37.1, ay + k * 17.7, az + k * 53.3);
        const dA3y = (A(x, y + e, z, 2) - A(x, y - e, z, 2)) / (2 * e);
        const dA2z = (A(x, y, z + e, 1) - A(x, y, z - e, 1)) / (2 * e);
        const dA1z = (A(x, y, z + e, 0) - A(x, y, z - e, 0)) / (2 * e);
        const dA3x = (A(x + e, y, z, 2) - A(x - e, y, z, 2)) / (2 * e);
        const dA2x = (A(x + e, y, z, 1) - A(x - e, y, z, 1)) / (2 * e);
        const dA1y = (A(x, y + e, z, 0) - A(x, y - e, z, 0)) / (2 * e);
        out3[0] = dA3y - dA2z;
        out3[1] = dA1z - dA3x;
        out3[2] = dA2x - dA1y;
      } else {
        // spiral vortex with a breathing core
        const r2 = x * x + z * z;
        const sw = 2.2 * Math.exp(-r2 / 6);
        out3[0] = -z * sw + 0.3 * x * (1 - r2 / 9);
        out3[1] = 0.5 * Math.sin(2 * x + t * 0.7) * Math.cos(2 * z);
        out3[2] = x * sw + 0.3 * z * (1 - r2 / 9);
      }
    };
    const vtmp = new Float64Array(3);
    return {
      step(dt, time, out) {
        const trail = clamp(Math.round(p.trail), 2, HIST);
        const slot = frame % HIST;
        for (let i = 0; i < N; i++) {
          const x = pos[i * 3],
            y = pos[i * 3 + 1],
            z = pos[i * 3 + 2];
          fieldAt(x, y, z, vtmp, time);
          let vx = vtmp[0],
            vy = vtmp[1],
            vz = vtmp[2];
          const vm = Math.hypot(vx, vy, vz) || 1;
          const sp = (0.55 + 0.45 * clamp(vm / 2, 0, 1)) * p.speed;
          vx = (vx / vm) * sp;
          vy = (vy / vm) * sp;
          vz = (vz / vm) * sp;
          let nx = x + vx * dt * 1.4;
          let ny = y + vy * dt * 1.4;
          let nz = z + vz * dt * 1.4;
          life[i] -= dt;
          if (nx * nx + ny * ny + nz * nz > 5.3 || life[i] <= 0) {
            respawn(i);
            nx = pos[i * 3];
            ny = pos[i * 3 + 1];
            nz = pos[i * 3 + 2];
            // reset the trail so it doesn't streak from the old position
            for (let s = 0; s < HIST; s++) {
              const hb2 = (s * N + i) * 3;
              hist[hb2] = nx;
              hist[hb2 + 1] = ny;
              hist[hb2 + 2] = nz;
            }
          }
          pos[i * 3] = nx;
          pos[i * 3 + 1] = ny;
          pos[i * 3 + 2] = nz;
          const hb = (slot * N + i) * 3;
          hist[hb] = nx;
          hist[hb + 1] = ny;
          hist[hb + 2] = nz;
        }
        frame++;
        out.mode = "emissive";
        out.depthTint = true;
        const sc = 1 / 1.35;
        for (let i = 0; i < N; i++) {
          for (let s = 0; s < trail; s++) {
            const sl = (frame - 1 - s + HIST * 4) % HIST;
            const hb = (sl * N + i) * 3;
            const fade = 1 - s / trail;
            frameGlow(
              out,
              hist[hb] * sc,
              hist[hb + 1] * sc,
              hist[hb + 2] * sc,
              0.1 + 0.8 * fade * fade,
            );
          }
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// particles riding an ABC flow: v = (sin z + cos y, sin x + cos z, sin y + cos x)
const count = ${Math.round(p.count)}, speed = ${F(p.speed)}, trailLen = ${Math.round(p.trail)}, seed = ${Math.round(p.seed)};
let rs = seed >>> 0;
const rnd = () => {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const P = [], hist = [], life = [];
for (let i = 0; i < count; i++) {
  let a = rnd() * 6.2832, c = rnd() * 2 - 1, s = Math.sqrt(1 - c * c), rr = 2 * Math.cbrt(rnd());
  P.push([s * Math.cos(a) * rr, s * Math.sin(a) * rr, c * rr]);
  hist.push([]);
  life.push(3 + rnd() * 7);
}
return {
  step(dt) {
    for (let i = 0; i < count; i++) {
      const p = P[i];
      const vx = Math.sin(p[2]) + Math.cos(p[1]);
      const vy = Math.sin(p[0]) + Math.cos(p[2]);
      const vz = Math.sin(p[1]) + Math.cos(p[0]);
      const vm = Math.hypot(vx, vy, vz) || 1;
      const sp = (0.55 + 0.45 * Math.min(1, vm / 2)) * speed;
      p[0] += (vx / vm) * sp * dt * 1.4;
      p[1] += (vy / vm) * sp * dt * 1.4;
      p[2] += (vz / vm) * sp * dt * 1.4;
      life[i] -= dt;
      if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > 5.3 || life[i] <= 0) {
        const a = rnd() * 6.2832, c = rnd() * 2 - 1, s = Math.sqrt(1 - c * c), rr = 2 * Math.cbrt(rnd());
        p[0] = s * Math.cos(a) * rr; p[1] = s * Math.sin(a) * rr; p[2] = c * rr;
        life[i] = 3 + rnd() * 7;
        hist[i] = [];
      }
      hist[i].push([p[0], p[1], p[2]]);
      if (hist[i].length > trailLen) hist[i].shift();
    }
    const sc = 1 / 1.35;
    for (let i = 0; i < count; i++) {
      const h = hist[i];
      for (let s = 0; s < h.length; s++) {
        const fade = 1 - s / trailLen;
        glow(h[s][0] * sc, h[s][1] * sc, h[s][2] * sc, 0.1 + 0.8 * fade * fade);
      }
    }
  },
};`,
      "Flow Field",
    ),
};

// ---------------------------------------------------------------------------
// Boids — separation, alignment, cohesion inside a soft sphere.
// ---------------------------------------------------------------------------

export const boids: Shape = {
  id: "boids",
  name: "Boids ⟲",
  category: "Simulations",
  description:
    "Craig Reynolds' flocking: separation + alignment + cohesion over soft-sphere bounds. Deterministic for a fixed seed.",
  animated: true,
  params: [
    { key: "count", label: "agents", min: 20, max: 300, step: 10, def: 140, int: true },
    { key: "sep", label: "separation", min: 0, max: 2, step: 0.05, def: 1.2 },
    { key: "ali", label: "alignment", min: 0, max: 2, step: 0.05, def: 1 },
    { key: "coh", label: "cohesion", min: 0, max: 2, step: 0.05, def: 0.8 },
    { key: "radius", label: "perception", min: 0.2, max: 1, step: 0.05, def: 0.5 },
    { key: "speed", label: "speed", min: 0.5, max: 2.5, step: 0.05, def: 1.2 },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const N = clamp(Math.round(p.count), 5, 300);
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const rng = mulberry32(seed);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rng() * 2 - 1) * 1.5;
      pos[i * 3 + 1] = (rng() * 2 - 1) * 1.5;
      pos[i * 3 + 2] = (rng() * 2 - 1) * 1.5;
      const th = rng() * TAU;
      const ph = Math.acos(rng() * 2 - 1);
      vel[i * 3] = Math.sin(ph) * Math.cos(th);
      vel[i * 3 + 1] = Math.cos(ph);
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th);
    }
    const R2 = p.radius * p.radius;
    const R2n = p.radius * 0.45 * (p.radius * 0.45);
    return {
      step(dt, _time, out) {
        const acc = new Float64Array(N * 3);
        for (let i = 0; i < N; i++) {
          let sepx = 0,
            sepy = 0,
            sepz = 0,
            nsep = 0;
          let alix = 0,
            aliy = 0,
            aliz = 0;
          let cohx = 0,
            cohy = 0,
            cohz = 0,
            nc = 0;
          for (let j = 0; j < N; j++) {
            if (j === i) continue;
            const dx = pos[j * 3] - pos[i * 3];
            const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
            const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R2) continue;
            alix += vel[j * 3];
            aliy += vel[j * 3 + 1];
            aliz += vel[j * 3 + 2];
            cohx += pos[j * 3];
            cohy += pos[j * 3 + 1];
            cohz += pos[j * 3 + 2];
            nc++;
            if (d2 < R2n && d2 > 1e-9) {
              const inv = 1 / d2;
              sepx -= dx * inv;
              sepy -= dy * inv;
              sepz -= dz * inv;
              nsep++;
            }
          }
          let ax = 0,
            ay = 0,
            az = 0;
          if (nsep > 0) {
            ax += sepx * p.sep * 6;
            ay += sepy * p.sep * 6;
            az += sepz * p.sep * 6;
          }
          if (nc > 0) {
            ax += (alix / nc - vel[i * 3]) * p.ali * 2.2;
            ay += (aliy / nc - vel[i * 3 + 1]) * p.ali * 2.2;
            az += (aliz / nc - vel[i * 3 + 2]) * p.ali * 2.2;
            ax += (cohx / nc - pos[i * 3]) * p.coh * 1.6;
            ay += (cohy / nc - pos[i * 3 + 1]) * p.coh * 1.6;
            az += (cohz / nc - pos[i * 3 + 2]) * p.coh * 1.6;
          }
          const pr = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          if (pr > 1.7) {
            const f = (pr - 1.7) * 8;
            ax -= (pos[i * 3] / pr) * f;
            ay -= (pos[i * 3 + 1] / pr) * f;
            az -= (pos[i * 3 + 2] / pr) * f;
          }
          acc[i * 3] = ax;
          acc[i * 3 + 1] = ay;
          acc[i * 3 + 2] = az;
        }
        const vmin = p.speed * 0.55;
        const vmax = p.speed * 1.5;
        for (let i = 0; i < N; i++) {
          vel[i * 3] += acc[i * 3] * dt;
          vel[i * 3 + 1] += acc[i * 3 + 1] * dt;
          vel[i * 3 + 2] += acc[i * 3 + 2] * dt;
          const vm = Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]) || 1;
          const cl = clamp(vm, vmin, vmax) / vm;
          vel[i * 3] *= cl;
          vel[i * 3 + 1] *= cl;
          vel[i * 3 + 2] *= cl;
          pos[i * 3] += vel[i * 3] * dt;
          pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
          pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        }
        out.mode = "emissive";
        out.depthTint = false;
        const sc = 1 / 1.45;
        for (let i = 0; i < N; i++) {
          const x = pos[i * 3] * sc,
            y = pos[i * 3 + 1] * sc,
            z = pos[i * 3 + 2] * sc;
          const vm = Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]) || 1;
          frameGlow(out, x, y, z, 0.95);
          frameGlow(
            out,
            x - (vel[i * 3] / vm) * 0.09,
            y - (vel[i * 3 + 1] / vm) * 0.09,
            z - (vel[i * 3 + 2] / vm) * 0.09,
            0.45,
          );
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// boids: separation + alignment + cohesion in a soft sphere
const count = ${Math.round(p.count)}, wSep = ${F(p.sep)}, wAli = ${F(p.ali)}, wCoh = ${F(p.coh)};
const R = ${F(p.radius)}, speed = ${F(p.speed)}, seed = ${Math.round(p.seed)};
let rs = seed >>> 0;
const rnd = () => {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const P = [], V = [];
for (let i = 0; i < count; i++) {
  P.push([(rnd() * 2 - 1) * 1.5, (rnd() * 2 - 1) * 1.5, (rnd() * 2 - 1) * 1.5]);
  const th = rnd() * 6.2832, ph = Math.acos(rnd() * 2 - 1);
  V.push([sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)]);
}
return {
  step(dt) {
    for (let i = 0; i < count; i++) {
      let sx = 0, sy = 0, sz = 0, ns = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, nc = 0;
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], dz = P[j][2] - P[i][2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        ax += V[j][0]; ay += V[j][1]; az += V[j][2];
        cx += P[j][0]; cy += P[j][1]; cz += P[j][2]; nc++;
        if (d2 < R * R * 0.2 && d2 > 1e-9) { const inv = 1 / d2; sx -= dx * inv; sy -= dy * inv; sz -= dz * inv; ns++; }
      }
      let fx = 0, fy = 0, fz = 0;
      if (ns > 0) { fx += sx * wSep * 6; fy += sy * wSep * 6; fz += sz * wSep * 6; }
      if (nc > 0) {
        fx += (ax / nc - V[i][0]) * wAli * 2.2; fy += (ay / nc - V[i][1]) * wAli * 2.2; fz += (az / nc - V[i][2]) * wAli * 2.2;
        fx += (cx / nc - P[i][0]) * wCoh * 1.6; fy += (cy / nc - P[i][1]) * wCoh * 1.6; fz += (cz / nc - P[i][2]) * wCoh * 1.6;
      }
      const pr = hypot(P[i][0], P[i][1], P[i][2]);
      if (pr > 1.7) { const f = (pr - 1.7) * 8; fx -= (P[i][0] / pr) * f; fy -= (P[i][1] / pr) * f; fz -= (P[i][2] / pr) * f; }
      V[i][0] += fx * dt; V[i][1] += fy * dt; V[i][2] += fz * dt;
      const vm = hypot(V[i][0], V[i][1], V[i][2]) || 1;
      const cl = min(speed * 1.5, max(speed * 0.55, vm)) / vm;
      V[i][0] *= cl; V[i][1] *= cl; V[i][2] *= cl;
      P[i][0] += V[i][0] * dt; P[i][1] += V[i][1] * dt; P[i][2] += V[i][2] * dt;
    }
    const sc = 1 / 1.45;
    for (let i = 0; i < count; i++) {
      const x = P[i][0] * sc, y = P[i][1] * sc, z = P[i][2] * sc;
      const vm = hypot(V[i][0], V[i][1], V[i][2]) || 1;
      glow(x, y, z, 0.95);
      glow(x - (V[i][0] / vm) * 0.09, y - (V[i][1] / vm) * 0.09, z - (V[i][2] / vm) * 0.09, 0.45);
    }
  },
};`,
      "Boids",
    ),
};

// ---------------------------------------------------------------------------
// Reaction-diffusion (Gray–Scott) — stateful 2D simulation rendered as a
// planar density field. Evolves a little every frame.
// ---------------------------------------------------------------------------

const GW = 144;
const GH = 96;

export const reactionDiffusion: Shape = {
  id: "reactiondiffusion",
  name: "Reaction-Diffusion ⟲",
  category: "Simulations",
  description:
    "Gray–Scott Turing patterns: feed U, kill V — corals, mitosis and worms depending on feed/kill. Seeded spots grow into patterns.",
  animated: true,
  params: [
    { key: "feed", label: "feed F", min: 0.005, max: 0.09, step: 0.001, def: 0.037 },
    { key: "kill", label: "kill k", min: 0.03, max: 0.073, step: 0.001, def: 0.06 },
    { key: "dA", label: "diffusion U", min: 0.2, max: 1.2, step: 0.05, def: 1 },
    { key: "dB", label: "diffusion V", min: 0.1, max: 0.6, step: 0.05, def: 0.5 },
    { key: "steps", label: "steps / frame", min: 1, max: 10, step: 1, def: 6, int: true },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    let A = new Float32Array(GW * GH).fill(1);
    let B = new Float32Array(GW * GH);
    let A2 = new Float32Array(GW * GH);
    let B2 = new Float32Array(GW * GH);
    const rng = mulberry32(seed);
    const stampBlobs = () => {
      for (let b = 0; b < 14; b++) {
        const bx = 8 + rng() * (GW - 16);
        const by = 8 + rng() * (GH - 16);
        const r = 2.5 + rng() * 3;
        for (let y = Math.floor(by - r); y <= by + r; y++) {
          for (let x = Math.floor(bx - r); x <= bx + r; x++) {
            if ((x - bx) * (x - bx) + (y - by) * (y - by) <= r * r) {
              const xi = clamp(x, 0, GW - 1);
              const yi = clamp(y, 0, GH - 1);
              B[yi * GW + xi] = 1;
              A[yi * GW + xi] = 0;
            }
          }
        }
      }
    };
    stampBlobs();
    const lap = (src: Float32Array, i: number, x: number, y: number): number => {
      const c = src[i];
      const l = x > 0 ? src[i - 1] : c;
      const r = x < GW - 1 ? src[i + 1] : c;
      const u = y > 0 ? src[i - GW] : c;
      const d = y < GH - 1 ? src[i + GW] : c;
      const ul = x > 0 && y > 0 ? src[i - GW - 1] : c;
      const ur = x < GW - 1 && y > 0 ? src[i - GW + 1] : c;
      const dl = x > 0 && y < GH - 1 ? src[i + GW - 1] : c;
      const dr = x < GW - 1 && y < GH - 1 ? src[i + GW + 1] : c;
      return -c + 0.2 * (l + r + u + d) + 0.05 * (ul + ur + dl + dr);
    };
    const substep = () => {
      const F = p.feed,
        k = p.kill,
        dA = p.dA,
        dB = p.dB;
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          const a = A[i];
          const b = B[i];
          const r = a * b * b;
          A2[i] = clamp(a + dA * lap(A, i, x, y) - r + F * (1 - a), 0, 1);
          B2[i] = clamp(b + dB * lap(B, i, x, y) + r - (F + k) * b, 0, 1);
        }
      }
      const t = A;
      A = A2;
      A2 = t;
      const t2 = B;
      B = B2;
      B2 = t2;
    };
    return {
      step(dt) {
        if (dt <= 0) return;
        const n = clamp(Math.round(p.steps), 1, 10);
        for (let i = 0; i < n; i++) substep();
      },
      planar(cols, rows, _aspect, out) {
        for (let row = 0; row < rows; row++) {
          const gy = clamp(Math.floor((row / rows) * GH), 0, GH - 1);
          for (let col = 0; col < cols; col++) {
            const gx = clamp(Math.floor((col / cols) * GW), 0, GW - 1);
            out[row * cols + col] = clamp01(B[gy * GW + gx] * 4);
          }
        }
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// Gray-Scott reaction-diffusion on a 144x96 grid, drawn to the screen
const GW = 144, GH = 96, F = ${F(p.feed)}, k = ${F(p.kill)}, dA = ${F(p.dA)}, dB = ${F(p.dB)}, steps = ${Math.round(p.steps)};
let rndState = ${Math.round(p.seed)} >>> 0;
const rnd = () => {
  rndState = (rndState + 0x6d2b79f5) | 0;
  let t = Math.imul(rndState ^ (rndState >>> 15), 1 | rndState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let A = new Array(GW * GH).fill(1), B = new Array(GW * GH).fill(0);
for (let b = 0; b < 14; b++) {
  const bx = 8 + rnd() * (GW - 16), by = 8 + rnd() * (GH - 16), r = 2.5 + rnd() * 3;
  for (let y = floor(by - r); y <= by + r; y++)
    for (let x = floor(bx - r); x <= bx + r; x++)
      if ((x - bx) * (x - bx) + (y - by) * (y - by) <= r * r) {
        const xi = max(0, min(GW - 1, x)), yi = max(0, min(GH - 1, y));
        B[yi * GW + xi] = 1; A[yi * GW + xi] = 0;
      }
}
const lap = (s, i, x, y) => {
  const c = s[i];
  const l = x > 0 ? s[i - 1] : c, r = x < GW - 1 ? s[i + 1] : c;
  const u = y > 0 ? s[i - GW] : c, d = y < GH - 1 ? s[i + GW] : c;
  const ul = x > 0 && y > 0 ? s[i - GW - 1] : c, ur = x < GW - 1 && y > 0 ? s[i - GW + 1] : c;
  const dl = x > 0 && y < GH - 1 ? s[i + GW - 1] : c, dr = x < GW - 1 && y < GH - 1 ? s[i + GW + 1] : c;
  return -c + 0.2 * (l + r + u + d) + 0.05 * (ul + ur + dl + dr);
};
return {
  step(dt) {
    if (dt <= 0) return;
    for (let n = 0; n < steps; n++) {
      let A2 = A.slice(), B2 = B.slice();
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x, a = A[i], b = B[i], r = a * b * b;
          A2[i] = min(1, max(0, a + dA * lap(A, i, x, y) - r + F * (1 - a)));
          B2[i] = min(1, max(0, b + dB * lap(B, i, x, y) + r - (F + k) * b));
        }
      let t = A; A = A2; A2 = t;
      t = B; B = B2; B2 = t;
    }
  },
  planar(cols, rows, aspect, out) {
    for (let row = 0; row < rows; row++) {
      const gy = min(GH - 1, floor((row / rows) * GH));
      for (let col = 0; col < cols; col++) {
        const gx = min(GW - 1, floor((col / cols) * GW));
        out[row * cols + col] = min(1, max(0, B[gy * GW + gx] * 4));
      }
    }
  },
};`,
      "Reaction-Diffusion",
    ),
};

// ---------------------------------------------------------------------------
// Aizawa attractor — spherical-geometry flow with parameters a..f:
//   ẋ = (z−b)x − d·y      ẏ = d·x + (z−b)y
//   ż = c + a·z − z³/3 − (x²+y²)(1+e·z) + f·z·x³
// Integrated with RK4 like the Lorenz; trajectory persists as a fading ring.
// ---------------------------------------------------------------------------

export const aizawa: Shape = {
  id: "aizawa",
  name: "Aizawa Attractor ⟲",
  category: "Simulations",
  description:
    "A torus wrapped in a bubbling sphere flow. Sits between the Lorenz butterfly and a smoke ring — try nudging d.",
  animated: true,
  params: [
    { key: "a", label: "a", min: 0.6, max: 1.4, step: 0.01, def: 0.95 },
    { key: "b", label: "b", min: 0.4, max: 1, step: 0.01, def: 0.7 },
    { key: "c", label: "c", min: 0.3, max: 1, step: 0.01, def: 0.6 },
    { key: "d", label: "d", min: 2, max: 5, step: 0.05, def: 3.5 },
    { key: "speed", label: "speed", min: 0.1, max: 3, step: 0.05, def: 1 },
    { key: "trail", label: "trail length", min: 500, max: 8000, step: 500, def: 4000, int: true },
    seedSpec,
  ],
  sim: (p, seed): Sim => {
    const A = p.a,
      B = p.b,
      C = p.c,
      D = p.d;
    const E = 0.25,
      G = 0.1; // e, f fixed — the visually stable region
    const rk = makeRk4(3, (y, dy) => {
      dy[0] = (y[2] - B) * y[0] - D * y[1];
      dy[1] = D * y[0] + (y[2] - B) * y[1];
      dy[2] =
        C +
        A * y[2] -
        (y[2] * y[2] * y[2]) / 3 -
        (y[0] * y[0] + y[1] * y[1]) * (1 + E * y[2]) +
        G * y[2] * y[0] * y[0] * y[0];
    });
    const rng = mulberry32(seed);
    rk.y[0] = 0.1 + 0.05 * rng();
    rk.y[1] = 0.1 + 0.05 * rng();
    rk.y[2] = 0.8 + 0.1 * rng();
    const cap = clamp(Math.round(p.trail), 500, 8000);
    const trail = new Float32Array(cap * 3);
    let head = 0;
    let len = 0;
    const H = 0.008;
    const emit = (x: number, y: number, z: number): void => {
      trail[head * 3] = x / 1.6;
      trail[head * 3 + 1] = y / 1.6;
      trail[head * 3 + 2] = (z - 0.7) / 1.6;
      head = (head + 1) % cap;
      if (len < cap) len++;
    };
    return {
      step(dt, _time, out) {
        const steps = clamp(Math.round((dt * p.speed) / H), 0, 60);
        for (let i = 0; i < steps; i++) {
          rk.step(H);
          emit(rk.y[0], rk.y[1], rk.y[2]);
        }
        out.mode = "emissive";
        out.depthTint = true;
        for (let i = 0; i < len; i++) {
          const idx = (head - 1 - i + cap * 2) % cap;
          const fade = 1 - i / len;
          frameGlow(
            out,
            trail[idx * 3],
            trail[idx * 3 + 1],
            trail[idx * 3 + 2],
            0.1 + 0.88 * fade * fade,
          );
        }
        const hx = rk.y[0] / 1.6,
          hy = rk.y[1] / 1.6,
          hz = (rk.y[2] - 0.7) / 1.6;
        for (let i = 0; i < 5; i++) frameGlow(out, hx, hy, hz, 1);
      },
    };
  },
  toCode: (p) =>
    simCode(
      `// Aizawa attractor
// dx = (z-b)x - d*y   dy = d*x + (z-b)*y
// dz = c + a*z - z^3/3 - (x^2+y^2)(1+e*z) + f*z*x^3
const a = ${F(p.a)}, b = ${F(p.b)}, c = ${F(p.c)}, d = ${F(p.d)};
const e = 0.25, g = 0.1, speed = ${F(p.speed)}, cap = ${Math.round(p.trail)};
let x = 0.1, y = 0.1, z = 0.8;
const trail = [];
const f = (q) => [
  (q[2] - b) * q[0] - d * q[1],
  d * q[0] + (q[2] - b) * q[1],
  c + a * q[2] - q[2] ** 3 / 3 - (q[0] ** 2 + q[1] ** 2) * (1 + e * q[2]) + g * q[2] * q[0] ** 3
];
return {
  step(dt) {
    const H = 0.008;
    const steps = Math.max(0, Math.min(60, Math.round((dt * speed) / H)));
    for (let s = 0; s < steps; s++) {
      const q = [x, y, z];
      const k1 = f(q);
      const k2 = f([q[0] + H / 2 * k1[0], q[1] + H / 2 * k1[1], q[2] + H / 2 * k1[2]]);
      const k3 = f([q[0] + H / 2 * k2[0], q[1] + H / 2 * k2[1], q[2] + H / 2 * k2[2]]);
      const k4 = f([q[0] + H * k3[0], q[1] + H * k3[1], q[2] + H * k3[2]]);
      x += H / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += H / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      z += H / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      trail.push([x / 1.6, y / 1.6, (z - 0.7) / 1.6]);
      if (trail.length > cap) trail.shift();
    }
    for (let i = 0; i < trail.length; i++) {
      const fade = 1 - i / trail.length;
      const q = trail[trail.length - 1 - i];
      glow(q[0], q[1], q[2], 0.1 + 0.88 * fade * fade);
    }
    for (let i = 0; i < 5; i++) glow(x / 1.6, y / 1.6, (z - 0.7) / 1.6, 1);
  },
};`,
      "Aizawa Attractor",
    ),
};
