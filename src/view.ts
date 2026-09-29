/**
 * Shared view math: zoom bounds, the home orbit, and the idle-skip frame
 * signature. Pure data and functions — consumed by the canvas view component
 * and the terminal CLI alike, so both frame loops skip work identically.
 */
import type { ViewSettings } from "./types";

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 4;
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
export const HOME_ANGLES: [number, number, number] = [0.6, 0.4, 0];

/**
 * Everything outside the geometry that shapes a frame: grid size, angles, camera,
 * light/shading, raster options, charset and theme. When this matches the previous
 * frame AND the geometry is static (RenderResult.static), the output is identical,
 * so the whole render+draw pipeline can be skipped.
 */
export function viewSig(
  cols: number,
  rows: number,
  a: [number, number, number],
  s: ViewSettings,
): string {
  return (
    cols +
    "x" +
    rows +
    "|" +
    a[0] +
    "," +
    a[1] +
    "," +
    a[2] +
    "|" +
    s.zoom +
    "," +
    s.fov +
    "," +
    s.camDist +
    "," +
    s.projection +
    "|" +
    s.light[0] +
    "," +
    s.light[1] +
    "," +
    s.light[2] +
    "|" +
    s.ambient +
    "," +
    s.diffuse +
    "," +
    s.specular +
    "," +
    s.shininess +
    "," +
    s.pointSize +
    "," +
    s.jitter +
    "," +
    s.persistence +
    "," +
    s.fog +
    "," +
    s.samples +
    "," +
    s.samplesV +
    "|" +
    s.charset +
    "|" +
    s.theme.name +
    "," +
    s.theme.bg +
    "," +
    s.theme.fg +
    "," +
    s.theme.glow +
    "," +
    s.theme.mode +
    "|" +
    s.colorMode
  );
}
