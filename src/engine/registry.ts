import { PRESETS, SHADER_PRESETS } from "./presets";
import { type Category, type ShapeEntry } from "./types";
import {
  boys,
  catenoid,
  dini,
  enneper,
  gyroid,
  helicoid,
  hyperParaboloid,
  hyperboloid,
  kleinQuartic,
  roman,
  schwarzP,
  sphericalHarmonicShape,
  superquadric,
  supershape,
} from "./shapes/surfaces";
import { cinquefoil, figureEight, lissajous, torusKnot } from "./shapes/knots";
import {
  dodecahedron,
  hexahedron,
  icosahedron,
  octahedron,
  tesseract,
  tetrahedron,
} from "./shapes/polytopes";
import {
  barnsleyFern,
  burningShip,
  julia,
  mandelbrot,
  menger,
  sierpinski,
} from "./shapes/fractals";
import { asciiCursor, asciiRipple, asciiTiles, asciiWaves, liquidAscii } from "./shapes/effects";
import { clifford, dejong, hopf } from "./shapes/attractors";
import {
  aizawa,
  boids,
  doublePendulum,
  flowField,
  lorenz,
  metaballs,
  reactionDiffusion,
  rippleInterference,
} from "./shapes/sims";

/**
 * The shape registry: every selectable object, without code changes.
 * The 13 legacy code-string presets come first, in their original order,
 * each tagged into the category it leads, so keyboard shortcuts 1–9
 * (torus, sphere, sin·cos, Möbius, Klein, trefoil, seashell, heart,
 * Gaussian) and v1 saved states keep working unchanged.
 */
export const SHAPES: ShapeEntry[] = [
  ...PRESETS.map((def): ShapeEntry => ({ tag: "code", def })),
  { tag: "native", shape: catenoid },
  { tag: "native", shape: helicoid },
  { tag: "native", shape: dini },
  { tag: "native", shape: enneper },
  { tag: "native", shape: hyperParaboloid },
  { tag: "native", shape: hyperboloid },
  { tag: "native", shape: boys },
  { tag: "native", shape: roman },
  { tag: "native", shape: gyroid },
  { tag: "native", shape: schwarzP },
  { tag: "native", shape: kleinQuartic },
  { tag: "native", shape: superquadric },
  { tag: "native", shape: sphericalHarmonicShape },
  { tag: "native", shape: supershape },
  { tag: "native", shape: torusKnot },
  { tag: "native", shape: figureEight },
  { tag: "native", shape: cinquefoil },
  { tag: "native", shape: lissajous },
  { tag: "native", shape: hopf },
  { tag: "native", shape: tetrahedron },
  { tag: "native", shape: hexahedron },
  { tag: "native", shape: octahedron },
  { tag: "native", shape: icosahedron },
  { tag: "native", shape: dodecahedron },
  { tag: "native", shape: tesseract },
  { tag: "native", shape: menger },
  { tag: "native", shape: sierpinski },
  { tag: "native", shape: mandelbrot },
  { tag: "native", shape: julia },
  { tag: "native", shape: burningShip },
  { tag: "native", shape: barnsleyFern },
  { tag: "native", shape: clifford },
  { tag: "native", shape: dejong },
  { tag: "native", shape: metaballs },
  { tag: "native", shape: rippleInterference },
  { tag: "native", shape: doublePendulum },
  { tag: "native", shape: lorenz },
  { tag: "native", shape: aizawa },
  { tag: "native", shape: flowField },
  { tag: "native", shape: boids },
  { tag: "native", shape: reactionDiffusion },
  // interactive pointer-driven effects
  { tag: "native", shape: asciiRipple },
  { tag: "native", shape: liquidAscii },
  { tag: "native", shape: asciiCursor },
  { tag: "native", shape: asciiWaves },
  { tag: "native", shape: asciiTiles },
  // editable shaders — appended last so shortcut positions stay stable
  ...SHADER_PRESETS.map((def): ShapeEntry => ({ tag: "code", def })),
];

export function entryId(e: ShapeEntry): string {
  return e.tag === "code" ? e.def.id : e.shape.id;
}

export function entryName(e: ShapeEntry): string {
  return e.tag === "code" ? e.def.name : e.shape.name;
}

export function entryDescription(e: ShapeEntry): string {
  return e.tag === "code" ? e.def.description : e.shape.description;
}

export function entryCategory(e: ShapeEntry): Category {
  return e.tag === "code" ? (e.def.category ?? "Surfaces") : e.shape.category;
}

const byId = new Map<string, ShapeEntry>();
for (const s of SHAPES) byId.set(entryId(s), s);

/** Look up a registry entry by id; null for ids like "custom" that aren't registered. */
export function findEntry(id: string): ShapeEntry | null {
  return byId.get(id) ?? null;
}

export function entriesInCategory(cat: Category | "All"): ShapeEntry[] {
  return cat === "All" ? SHAPES : SHAPES.filter((s) => entryCategory(s) === cat);
}
