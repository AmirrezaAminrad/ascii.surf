// Shared app-level types. These describe the full view/render configuration and
// the per-frame stats contract, consumed by the engine-facing view component,
// the persistence codec and the status bar — so they live here, outside any
// component module.
import type { ColorMode } from "./engine/exports";
import type { Vec3 } from "./engine/types";
import type { Theme } from "./themes";

export interface ViewSettings {
  fontSize: number;
  charset: string;
  light: Vec3;
  zoom: number;
  speed: number;
  autoRotate: boolean;
  samples: number; // samples along u
  samplesV: number; // samples along v (0 = follow samples → square grid)
  theme: Theme;
  spin: Vec3; // rotation rates per axis
  paused: boolean; // freezes surface time `t` (rotation keeps its own controls)
  timeScale: number; // multiplier for `t` accumulation
  projection: "perspective" | "ortho";
  fov: number; // screen gain (2.4 = legacy framing)
  camDist: number; // camera distance
  ambient: number; // ambient light
  diffuse: number; // diffuse strength
  specular: number; // Blinn-Phong strength (0 = legacy look)
  shininess: number; // specular exponent
  pointSize: number; // cells per sample point: 1 | 2 | 3
  jitter: number; // 0..1 deterministic sample dither
  persistence: number; // 0..0.95 phosphor afterglow (screen-level trail mix)
  fog: number; // 0..1 depth fog: dim points farther from the camera
  debug: boolean; // extended readout in the status bar
  demoDwell: number; // demo-mode seconds per shape
  gridOverlay: boolean; // faint character-cell grid overlay
  pngScale: number; // PNG export upscaling: 1 | 2 | 3
  pngTransparent: boolean; // strip the background from PNG exports
  colorMode: ColorMode; // luminance → color mapping: theme ramp, spectral rainbow, animated plasma
}

export interface ViewApi {
  resetView: () => void;
  resetTime: () => void;
  nudge: (dx: number, dy: number) => void;
}

export interface Stats {
  fps: number;
  ms: number; // smoothed total frame work (render + draw)
  engineMs: number; // renderFrame only
  drawMs: number; // canvas text drawing only
  points: number;
  cols: number;
  rows: number;
  angles: [number, number, number];
  time: number;
}
