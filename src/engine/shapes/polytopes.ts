import { clamp, clamp01, fmtNum, pushPoly } from "../math";
import {
  frameGlow,
  generateCode,
  type Params,
  type PointFrame,
  type Shape,
  type Vec3,
} from "../types";

const F = fmtNum;

/** Serialize scaled verts + faces into an editable generate-code body with fan sampling. */
function polyCodeBody(verts: Vec3[], faces: number[][], detail: number): string {
  const vStr = verts.map((v) => `[${F(v[0])}, ${F(v[1])}, ${F(v[2])}]`).join(", ");
  const fStr = faces.map((f) => `[${f.join(", ")}]`).join(", ");
  return `// vertices (scaled) and faces of the polyhedron — edit freely
const n = ${detail}; // points per face edge
const V = [${vStr}];
const F = [${fStr}];
for (const f of F) {
  const P = f.map((i) => V[i]);
  const m = P.length;
  let cx = 0, cy = 0, cz = 0;
  for (const q of P) { cx += q[0]; cy += q[1]; cz += q[2]; }
  cx /= m; cy /= m; cz /= m;
  const e1x = P[1][0] - P[0][0], e1y = P[1][1] - P[0][1], e1z = P[1][2] - P[0][2];
  const e2x = P[2][0] - P[0][0], e2y = P[2][1] - P[0][1], e2z = P[2][2] - P[0][2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nl = hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (cx * nx + cy * ny + cz * nz < 0) { nx = -nx; ny = -ny; nz = -nz; } // outward
  for (let k = 0; k < m; k++) {
    const A = P[k], B = P[(k + 1) % m]; // fan triangle (centroid, A, B)
    for (let i = 0; i < n; i++) {
      const a0 = i / (n - 1);
      for (let j = 0; j + i < n; j++) {
        const b0 = j / (n - 1);
        push(
          cx + a0 * (A[0] - cx) + b0 * (B[0] - cx),
          cy + a0 * (A[1] - cy) + b0 * (B[1] - cy),
          cz + a0 * (A[2] - cz) + b0 * (B[2] - cz),
          nx, ny, nz
        );
      }
    }
  }
}`;
}

// ---------------------------------------------------------------------------
// Platonic solids: canonical golden-ratio vertex constructions with fixed face
// tables (produced once from edge-distance adjacency, then verified: 20
// triangles / 12 pentagon cycles, every vertex covered). Faces are sampled as
// fans with flat normals in lit mode; drag rotates them like any other object.
// ---------------------------------------------------------------------------

function scaleVerts(verts: Vec3[], radius: number): Vec3[] {
  return verts.map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [(v[0] / l) * radius, (v[1] / l) * radius, (v[2] / l) * radius];
  });
}

/** Sample every face as a fan of `faceGrid`-per-edge points with a flat normal. */
function renderPolyhedron(
  verts: Vec3[],
  faces: number[][],
  faceGrid: number,
  out: PointFrame,
): void {
  for (const face of faces) {
    pushPoly(
      out,
      face.map((i) => verts[i]),
      faceGrid,
    );
  }
}

const PHI = (1 + Math.sqrt(5)) / 2;
const detailParam = {
  key: "detail",
  label: "face detail",
  min: 3,
  max: 20,
  step: 1,
  def: 10,
  int: true,
};

const ICO_VERTS: Vec3[] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

// every consecutive pair (incl. wraparound) is an edge of the solid
const ICO_FACES: number[][] = [
  [0, 1, 5],
  [0, 1, 7],
  [0, 5, 11],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [1, 7, 8],
  [1, 8, 9],
  [2, 3, 4],
  [2, 3, 6],
  [2, 4, 11],
  [2, 6, 10],
  [2, 10, 11],
  [3, 4, 9],
  [3, 6, 8],
  [3, 8, 9],
  [4, 5, 9],
  [4, 5, 11],
  [6, 7, 8],
  [6, 7, 10],
];

// cube corners (0–7), then (0, ±1/φ, ±φ) and its permutations (8–19)
const ip = 1 / PHI;
const DODECA_VERTS: Vec3[] = [];
for (const sx of [-1, 1])
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) DODECA_VERTS.push([sx, sy, sz]);
for (const sy of [-1, 1]) for (const sz of [-1, 1]) DODECA_VERTS.push([0, sy * ip, sz * PHI]);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) DODECA_VERTS.push([sx * ip, sz * PHI, 0]);
for (const sx of [-1, 1]) for (const sy of [-1, 1]) DODECA_VERTS.push([sx * PHI, 0, sy * ip]);

// pentagon cycles in the edge graph
const DODECA_FACES: number[][] = [
  [0, 8, 4, 14, 12],
  [0, 8, 10, 2, 16],
  [0, 12, 1, 17, 16],
  [1, 9, 5, 14, 12],
  [1, 9, 11, 3, 17],
  [2, 10, 6, 15, 13],
  [2, 13, 3, 17, 16],
  [3, 11, 7, 15, 13],
  [4, 8, 10, 6, 18],
  [4, 14, 5, 19, 18],
  [5, 9, 11, 7, 19],
  [6, 15, 7, 19, 18],
];

export const icosahedron: Shape = {
  id: "icosahedron",
  name: "Icosahedron",
  category: "Polytopes",
  description:
    "20 triangular faces on 12 golden-ratio vertices — the Platonic solid with fivefold symmetry. Drag to rotate.",
  animated: false,
  params: [{ key: "size", label: "size", min: 0.6, max: 2, step: 0.05, def: 1.25 }, detailParam],
  generate: (p, _time, out) => {
    renderPolyhedron(
      scaleVerts(ICO_VERTS, p.size),
      ICO_FACES,
      clamp(Math.round(p.detail), 3, 20),
      out,
    );
  },
  toCode: (p) =>
    generateCode(
      polyCodeBody(scaleVerts(ICO_VERTS, p.size), ICO_FACES, clamp(Math.round(p.detail), 3, 20)),
      "Icosahedron",
    ),
};

export const dodecahedron: Shape = {
  id: "dodecahedron",
  name: "Dodecahedron",
  category: "Polytopes",
  description: "12 pentagonal faces on 20 vertices — the icosahedron's dual. Drag to rotate.",
  animated: false,
  params: [{ key: "size", label: "size", min: 0.6, max: 2, step: 0.05, def: 1.25 }, detailParam],
  generate: (p, _time, out) => {
    renderPolyhedron(
      scaleVerts(DODECA_VERTS, p.size),
      DODECA_FACES,
      clamp(Math.round(p.detail), 3, 20),
      out,
    );
  },
  toCode: (p) =>
    generateCode(
      polyCodeBody(
        scaleVerts(DODECA_VERTS, p.size),
        DODECA_FACES,
        clamp(Math.round(p.detail), 3, 20),
      ),
      "Dodecahedron",
    ),
};

// The three remaining Platonic solids share the icosahedron/dodecahedron
// pipeline; their face tables are small enough to check by hand and are
// validated by project/qa/gen-faces.mjs.

const TETRA_VERTS: Vec3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

// every 3 of the 4 vertices form a face (K4)
const TETRA_FACES: number[][] = [
  [0, 1, 2],
  [0, 1, 3],
  [0, 2, 3],
  [1, 2, 3],
];

// corner i = [i&1 ? 1 : -1, i&2 ? 1 : -1, i&4 ? 1 : -1], one quad per axis side
const CUBE_FACES: number[][] = [
  [0, 2, 6, 4], // x −
  [1, 3, 7, 5], // x +
  [0, 1, 5, 4], // y −
  [2, 3, 7, 6], // y +
  [0, 1, 3, 2], // z −
  [4, 5, 7, 6], // z +
];

const OCTA_VERTS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// two pyramids base-to-base: +z cap, −z cap
const OCTA_FACES: number[][] = [
  [0, 2, 4],
  [2, 1, 4],
  [1, 3, 4],
  [3, 0, 4],
  [2, 0, 5],
  [1, 2, 5],
  [3, 1, 5],
  [0, 3, 5],
];

export const tetrahedron: Shape = {
  id: "tetrahedron",
  name: "Tetrahedron",
  category: "Polytopes",
  description:
    "The simplest Platonic solid: 4 triangular faces, each sharing an edge with every other. Drag to rotate.",
  animated: false,
  params: [{ key: "size", label: "size", min: 0.6, max: 2, step: 0.05, def: 1.45 }, detailParam],
  generate: (p, _time, out) => {
    renderPolyhedron(
      scaleVerts(TETRA_VERTS, p.size),
      TETRA_FACES,
      clamp(Math.round(p.detail), 3, 20),
      out,
    );
  },
  toCode: (p) =>
    generateCode(
      polyCodeBody(
        scaleVerts(TETRA_VERTS, p.size),
        TETRA_FACES,
        clamp(Math.round(p.detail), 3, 20),
      ),
      "Tetrahedron",
    ),
};

export const hexahedron: Shape = {
  id: "hexahedron",
  name: "Cube",
  category: "Polytopes",
  description:
    "The hexahedron: 6 square faces, 3 meeting at each of 8 corners — the only Platonic solid that tiles space. Drag to rotate.",
  animated: false,
  params: [{ key: "size", label: "size", min: 0.6, max: 2, step: 0.05, def: 1.15 }, detailParam],
  generate: (p, _time, out) => {
    const verts: Vec3[] = [];
    for (let i = 0; i < 8; i++) verts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    renderPolyhedron(
      scaleVerts(verts, p.size),
      CUBE_FACES,
      clamp(Math.round(p.detail), 3, 20),
      out,
    );
  },
  toCode: (p) => {
    const verts: Vec3[] = [];
    for (let i = 0; i < 8; i++) verts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    return generateCode(
      polyCodeBody(scaleVerts(verts, p.size), CUBE_FACES, clamp(Math.round(p.detail), 3, 20)),
      "Cube",
    );
  },
};

export const octahedron: Shape = {
  id: "octahedron",
  name: "Octahedron",
  category: "Polytopes",
  description:
    "8 triangular faces on 12 edges — the cube's dual, two square pyramids base to base. Drag to rotate.",
  animated: false,
  params: [{ key: "size", label: "size", min: 0.6, max: 2, step: 0.05, def: 1.45 }, detailParam],
  generate: (p, _time, out) => {
    renderPolyhedron(
      scaleVerts(OCTA_VERTS, p.size),
      OCTA_FACES,
      clamp(Math.round(p.detail), 3, 20),
      out,
    );
  },
  toCode: (p) =>
    generateCode(
      polyCodeBody(scaleVerts(OCTA_VERTS, p.size), OCTA_FACES, clamp(Math.round(p.detail), 3, 20)),
      "Octahedron",
    ),
};

// ---------------------------------------------------------------------------
// Tesseract: 16 vertices of the 4-cube, rotated in two 4D coordinate planes,
// perspective-projected 4D → 3D (w into the camera distance), then rendered as
// an emissive wireframe with the 4th coordinate as a depth tint.
// planes: 0:XY 1:XZ 2:XW 3:YZ 4:YW 5:ZW
// ---------------------------------------------------------------------------

const PLANES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

export const tesseract: Shape = {
  id: "tesseract",
  name: "Tesseract",
  category: "Polytopes",
  description:
    "The 4D hypercube: 16 vertices, 32 edges, double-rotated in 4D and projected 4D → 3D → ASCII. Watch the inner cube turn inside out.",
  animated: true,
  params: [
    { key: "plane1", label: "rotation 1", min: 0, max: 5, step: 1, def: 2, int: true },
    { key: "plane2", label: "rotation 2", min: 0, max: 5, step: 1, def: 3, int: true },
    { key: "wdist", label: "4D camera dist", min: 1.6, max: 4.5, step: 0.1, def: 2.6 },
    { key: "detail", label: "edge detail", min: 6, max: 26, step: 1, def: 14, int: true },
  ],
  generate: (p: Params, time: number, out: PointFrame) => {
    const vs: number[][] = [];
    for (let i = 0; i < 16; i++)
      vs.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
    const pl1 = PLANES[clamp(Math.round(p.plane1), 0, 5)];
    const pl2 = PLANES[clamp(Math.round(p.plane2), 0, 5)];
    const rot4 = (v: number[], a: number, b: number, th: number) => {
      const ca = Math.cos(th);
      const sa = Math.sin(th);
      const xa = v[a];
      const xb = v[b];
      v[a] = xa * ca - xb * sa;
      v[b] = xa * sa + xb * ca;
    };
    const proj = vs.map((v) => {
      const w = [...v];
      rot4(w, pl1[0], pl1[1], time * 0.55);
      if (pl1 !== pl2) rot4(w, pl2[0], pl2[1], time * 0.34);
      // sign-preserving epsilon: a vertex sweeping through the 4D camera
      // still flies off-screen, but k can't hit ±Infinity / NaN (0·∞)
      const den =
        w[3] >= p.wdist ? Math.max(p.wdist - w[3], -1e-4) : Math.max(p.wdist - w[3], 1e-4);
      const k = p.wdist / den;
      return [w[0] * k * 0.62, w[1] * k * 0.62, w[2] * k * 0.62, w[3]];
    });
    out.mode = "emissive";
    out.depthTint = true;
    const d = Math.max(2, Math.round(p.detail));
    for (let i = 0; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        let diff = 0;
        for (let c = 0; c < 4; c++) if (vs[i][c] !== vs[j][c]) diff++;
        if (diff !== 1) continue;
        const A = proj[i];
        const B = proj[j];
        for (let k2 = 0; k2 <= d; k2++) {
          const t = k2 / d;
          const w = A[3] + (B[3] - A[3]) * t;
          frameGlow(
            out,
            A[0] + (B[0] - A[0]) * t,
            A[1] + (B[1] - A[1]) * t,
            A[2] + (B[2] - A[2]) * t,
            0.22 + 0.78 * clamp01((w + 1.4) / 2.8),
          );
        }
      }
    }
    for (const V of proj) frameGlow(out, V[0], V[1], V[2], 1);
  },
  toCode: (p) =>
    generateCode(
      `// tesseract: 16 vertices, double-rotated in 4D, projected 4D -> 3D
// rotation planes: 0:XY 1:XZ 2:XW 3:YZ 4:YW 5:ZW
const p1 = ${clamp(Math.round(p.plane1), 0, 5)}, p2 = ${clamp(Math.round(p.plane2), 0, 5)};
const wd = ${F(p.wdist)}, detail = ${Math.max(2, Math.round(p.detail))};
const PLANES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const V = [];
for (let i = 0; i < 16; i++) V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const rot4 = (v, a, b, th) => {
  const c = cos(th), s = sin(th);
  const xa = v[a], xb = v[b];
  v[a] = xa * c - xb * s;
  v[b] = xa * s + xb * c;
};
const proj = V.map((v) => {
  const w = [...v];
  rot4(w, PLANES[p1][0], PLANES[p1][1], time * 0.55);
  if (p1 !== p2) rot4(w, PLANES[p2][0], PLANES[p2][1], time * 0.34);
  const den = w[3] >= wd ? max(wd - w[3], -1e-4) : max(wd - w[3], 1e-4);
  const k = wd / den;
  return [w[0] * k * 0.62, w[1] * k * 0.62, w[2] * k * 0.62, w[3]];
});
for (let i = 0; i < 16; i++) {
  for (let j = i + 1; j < 16; j++) {
    let diff = 0;
    for (let c = 0; c < 4; c++) if (V[i][c] !== V[j][c]) diff++;
    if (diff !== 1) continue;
    const A = proj[i], B = proj[j];
    for (let s = 0; s <= detail; s++) {
      const t = s / detail;
      const w = A[3] + (B[3] - A[3]) * t;
      glow(
        A[0] + (B[0] - A[0]) * t,
        A[1] + (B[1] - A[1]) * t,
        A[2] + (B[2] - A[2]) * t,
        0.22 + 0.78 * min(1, max(0, (w + 1.4) / 2.8))
      );
    }
  }
}
for (const q of proj) glow(q[0], q[1], q[2], 1);`,
      "Tesseract",
      true,
    ),
};
