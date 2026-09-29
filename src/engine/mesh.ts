/**
 * Mesh import: parse STL (binary + ASCII) and OBJ into a flat triangle buffer,
 * then expose it as a native Shape whose `generate` builder distributes a point
 * budget across triangle areas — riding the standard lit-point pipeline with
 * zero renderer changes. Geometry is static, so the renderer caches it.
 */
import { pushTri } from "./math";
import type { PointFrame, Shape } from "./types";

interface MeshData {
  /** xyz triplets, 9 floats per triangle, normalized to fit radius ~1.7 around origin */
  tris: Float32Array;
  triCount: number;
  name: string;
}

/** Hard cap so a pathological file can't OOM the tab (200k tris ≈ 29 MB of floats). */
const MAX_TRIS = 200_000;

/** The runtime-imported mesh's shape id — a virtual entry, not part of the registry, never persisted. */
export const MESH_ID = "custom-mesh";

/** Binary STL: 80-byte header + uint32 count + 50 bytes per triangle. */
function parseSTLBinary(buf: ArrayBuffer, name: string): MeshData {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  if (80 + 4 + n * 50 > buf.byteLength) {
    throw new Error(`STL header claims ${n.toLocaleString()} triangles but the file is too small`);
  }
  if (n > MAX_TRIS)
    throw new Error(
      `mesh has ${n.toLocaleString()} triangles — limit is ${MAX_TRIS.toLocaleString()}`,
    );
  const tris = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    // skip the 12-byte normal + 12-byte attrib-less per-tri header layout: 12 floats
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return finishMesh(tris, n, name);
}

/** ASCII STL: "vertex x y z" lines grouped in 3s inside "facet … endfacet" blocks. */
function parseSTLAscii(text: string, name: string): MeshData {
  const verts: number[] = [];
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    if (verts.length >= MAX_TRIS * 9) break;
  }
  if (verts.length < 9 || verts.length % 9 !== 0) {
    throw new Error("ASCII STL parse produced no complete triangles");
  }
  const tris = new Float32Array(verts);
  return finishMesh(tris, tris.length / 9, name);
}

function looksBinarySTL(buf: ArrayBuffer): boolean {
  // "solid" prefix with no "facet" keyword early on → binary; real ASCII files name a facet fast
  const head = new Uint8Array(buf, 0, Math.min(512, buf.byteLength));
  let text = "";
  for (const b of head) text += String.fromCharCode(b);
  if (!/^solid/i.test(text)) return true;
  return !/facet/i.test(text);
}

function parseSTL(buf: ArrayBuffer, name: string): MeshData {
  return looksBinarySTL(buf)
    ? parseSTLBinary(buf, name)
    : parseSTLAscii(new TextDecoder().decode(buf), name);
}

/** OBJ: positions + faces (fan-triangulated). v/vt/vn, v//vn and negative indices supported. */
function parseOBJ(text: string, name: string): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith("f ")) {
      const idx: number[] = [];
      for (const tok of line.trim().split(/\s+/).slice(1)) {
        const s = parseInt(tok.split("/")[0], 10);
        if (Number.isNaN(s)) continue;
        idx.push(s > 0 ? (s - 1) * 3 : (verts.length / 3 + s) * 3); // 1-based / relative
      }
      for (let k = 2; k < idx.length; k++) {
        if (tris.length / 3 >= MAX_TRIS)
          throw new Error(`mesh exceeds ${MAX_TRIS.toLocaleString()} triangle limit`);
        tris.push(idx[0], idx[k - 1], idx[k]);
      }
    }
  }
  if (verts.length < 9 || tris.length < 3) throw new Error("OBJ parse produced no triangles");
  // expand corner indices into xyz floats: 3 corners × 3 floats per triangle
  const out = new Float32Array((tris.length / 3) * 9);
  for (let i = 0; i < tris.length; i++) {
    const vi = tris[i];
    if (vi < 0 || vi + 2 >= verts.length) throw new Error("OBJ face references a missing vertex");
    if (!Number.isFinite(verts[vi])) throw new Error("OBJ contains a non-finite vertex");
    out[i * 3] = verts[vi];
    out[i * 3 + 1] = verts[vi + 1];
    out[i * 3 + 2] = verts[vi + 2];
  }
  return finishMesh(out, out.length / 9, name);
}

export async function parseMeshFile(file: File, buf: ArrayBuffer): Promise<MeshData> {
  const base = file.name.replace(/\.(stl|obj)$/i, "") || "mesh";
  if (/\.obj$/i.test(file.name)) return parseOBJ(new TextDecoder().decode(buf), base);
  if (/\.stl$/i.test(file.name)) return parseSTL(buf, base);
  // unknown extension: sniff
  return looksBinarySTL(buf)
    ? parseSTL(buf, base)
    : parseSTLAscii(new TextDecoder().decode(buf), base);
}

/** Center at the bbox centroid and scale so the largest extent spans 2.0 units
 * (±1.0 — matching the registry's typical object radius, so rotating corners
 * stay inside the default camera framing). */
function finishMesh(tris: Float32Array, triCount: number, name: string): MeshData {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i],
      y = tris[i + 1],
      z = tris[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const s = 2.0 / ext;
  for (let i = 0; i < tris.length; i += 3) {
    tris[i] = (tris[i] - cx) * s;
    tris[i + 1] = (tris[i + 1] - cy) * s;
    tris[i + 2] = (tris[i + 2] - cz) * s;
  }
  return { tris, triCount, name };
}

/**
 * Build a renderable Shape from parsed triangles. The `budget` param (thousands
 * of points) is a real slider: area-weighted distribution re-runs on change and
 * the renderer caches each static result.
 */
export function meshShape(data: MeshData): Shape {
  // per-triangle areas + normal cache: computed once, distribution re-runs per budget
  const n = data.triCount;
  const areas = new Float32Array(n);
  const nrms = new Float32Array(n * 3);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 9;
    const ax = data.tris[k],
      ay = data.tris[k + 1],
      az = data.tris[k + 2];
    const e1x = data.tris[k + 3] - ax,
      e1y = data.tris[k + 4] - ay,
      e1z = data.tris[k + 5] - az;
    const e2x = data.tris[k + 6] - ax,
      e2y = data.tris[k + 7] - ay,
      e2z = data.tris[k + 8] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    const area = len / 2;
    areas[i] = area;
    total += area;
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }
    nrms[i * 3] = nx;
    nrms[i * 3 + 1] = ny;
    nrms[i * 3 + 2] = nz;
  }
  return {
    id: "custom-mesh",
    name: data.name,
    category: "Surfaces",
    description: `Imported mesh — ${n.toLocaleString()} triangles. Density follows the point-budget slider.`,
    animated: false,
    params: [{ key: "budget", label: "point budget (k)", min: 5, max: 250, step: 5, def: 60 }],
    generate: (_p: Record<string, number>, _time: number, out: PointFrame) => {
      const budget = Math.max(1000, (_p.budget ?? 60) * 1000);
      // pushTri's n emits n(n+1)/2 points; invert that to hit the per-tri share
      const nFor = (share: number) =>
        Math.max(1, Math.round((Math.sqrt(1 + 8 * Math.max(0, share)) - 1) / 2));
      for (let i = 0; i < n; i++) {
        if (areas[i] <= 0) continue;
        const share = total > 0 ? (budget * areas[i]) / total : 1;
        const k = i * 9;
        pushTri(
          out,
          [data.tris[k], data.tris[k + 1], data.tris[k + 2]],
          [data.tris[k + 3], data.tris[k + 4], data.tris[k + 5]],
          [data.tris[k + 6], data.tris[k + 7], data.tris[k + 8]],
          nrms[i * 3],
          nrms[i * 3 + 1],
          nrms[i * 3 + 2],
          nFor(share),
        );
      }
    },
  };
}
