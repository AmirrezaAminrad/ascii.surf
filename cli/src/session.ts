/**
 * One render context: orbit angles, flick inertia, surface time, pointer state
 * and the per-frame RenderOptions — the terminal counterpart of AsciiView's
 * requestAnimationFrame loop, with the same idle-skip via viewSig.
 */
import { renderFrame, type RenderOptions, type RenderResult } from "../../src/engine/renderer";
import type { Pointer, Renderable, Vec3 } from "../../src/engine/types";
import type { ViewSettings } from "../../src/types";
import { HOME_ANGLES, viewSig } from "../../src/view";

/** Terminal cell height / width — most monospace fonts sit near 2.0. */
export const DEFAULT_CELL_ASPECT = 2;

/** A smooth lissajous sweep for --pointer-auto (no mouse needed for shaders/effects). */
export function autoPointer(t: number): { x: number; y: number } {
  return { x: 0.5 + 0.33 * Math.sin(t * 0.7), y: 0.5 + 0.28 * Math.cos(t * 0.53) };
}

export class RenderSession {
  angles: Vec3;
  velocity: [number, number] = [0, 0];
  time = 0;
  mouse: Pointer = { x: 0.5, y: 0.5, down: false };

  private simDt = 0;
  private lastSig = "";
  private lastStatic = false;
  private lastRenderable: Renderable | null = null;
  private readonly opt = {
    cols: 0,
    rows: 0,
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    zoom: 1,
    light: [0.4, 0.6, -1] as Vec3,
    charset: "",
    samplesU: 160,
    samplesV: 160,
    aspect: DEFAULT_CELL_ASPECT,
    time: 0,
    dt: 0,
    projection: "perspective" as const,
    fov: 2.4,
    camDist: 5,
    ambient: 0.12,
    diffuse: 0.88,
    specular: 0,
    shininess: 24,
    pointSize: 1,
    jitter: 0,
    persistence: 0,
    fog: 0,
  } as RenderOptions;

  constructor(initialAngles?: Vec3) {
    this.angles = initialAngles ? [...initialAngles] : [...HOME_ANGLES];
  }

  resetView(): void {
    this.angles = [...HOME_ANGLES];
    this.velocity = [0, 0];
  }

  nudge(dx: number, dy: number): void {
    this.angles[1] += dx;
    this.angles[0] += dy;
    this.velocity = [0, 0];
  }

  /** Drag-rotate with flick velocity (same model as the web pointer handlers). */
  dragBy(dxCells: number, dyCells: number, dtMs: number): void {
    this.angles[1] += dxCells * 0.01;
    this.angles[0] += dyCells * 0.01;
    const dtm = Math.min(100, Math.max(8, dtMs));
    const ivx = Math.max(-10, Math.min(10, ((dxCells * 0.01) / dtm) * 1000));
    const ivy = Math.max(-10, Math.min(10, ((dyCells * 0.01) / dtm) * 1000));
    this.velocity[0] = this.velocity[0] * 0.6 + ivx * 0.4;
    this.velocity[1] = this.velocity[1] * 0.6 + ivy * 0.4;
  }

  /** Advance rotation, inertia and surface time — call once per frame. */
  advance(dt: number, s: ViewSettings): void {
    const a = this.angles;
    if (s.autoRotate) {
      a[0] += s.spin[0] * s.speed * dt;
      a[1] += s.spin[1] * s.speed * dt;
      a[2] += s.spin[2] * s.speed * dt;
    }
    a[1] += this.velocity[0] * dt;
    a[0] += this.velocity[1] * dt;
    const decay = Math.pow(0.05, dt);
    this.velocity[0] *= decay;
    this.velocity[1] *= decay;
    this.simDt = s.paused ? 0 : dt * s.timeScale;
    if (this.simDt > 0) this.time += this.simDt;
  }

  /** Render the frame; "idle" means it would be identical to the last one. */
  render(
    r: Renderable,
    cols: number,
    rows: number,
    s: ViewSettings,
    cellAspect: number,
  ): RenderResult | "idle" {
    const sig = viewSig(cols, rows, this.angles, s);
    if (
      this.lastStatic &&
      this.lastRenderable === r &&
      s.persistence === 0 &&
      s.colorMode !== "plasma" &&
      Math.abs(this.velocity[0]) < 1e-4 &&
      Math.abs(this.velocity[1]) < 1e-4 &&
      sig === this.lastSig
    ) {
      return "idle";
    }

    const opt = this.opt;
    opt.cols = cols;
    opt.rows = rows;
    opt.angleX = this.angles[0];
    opt.angleY = this.angles[1];
    opt.angleZ = this.angles[2];
    opt.zoom = s.zoom;
    opt.light = s.light;
    opt.charset = s.charset;
    opt.samplesU = s.samples;
    opt.samplesV = s.samplesV > 0 ? s.samplesV : s.samples;
    opt.aspect = cellAspect;
    opt.time = this.time;
    opt.dt = this.simDt;
    opt.projection = s.projection;
    opt.fov = s.fov;
    opt.camDist = s.camDist;
    opt.ambient = s.ambient;
    opt.diffuse = s.diffuse;
    opt.specular = s.specular;
    opt.shininess = s.shininess;
    opt.pointSize = s.pointSize;
    opt.jitter = s.jitter;
    opt.persistence = s.persistence;
    opt.fog = s.fog;
    opt.mouse = this.mouse;

    const res = renderFrame(r, opt);
    // commit the signature only after a successful render — the same contract
    // as AsciiView's loop, so a thrown frame retries on the next tick instead
    // of idling forever on a signature that never actually rendered
    this.lastSig = sig;
    this.lastRenderable = r;
    this.lastStatic = res.static === true;
    return res;
  }
}
