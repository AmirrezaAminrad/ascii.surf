import { describe, expect, it } from "vitest";
import { viewSig } from "./view";
import type { ViewSettings } from "./types";
import { THEMES } from "./themes";

// The idle-frame skip in AsciiView redraws ONLY when this signature changes
// (for static geometry). Every field that can alter a drawn frame must be
// reflected here — these tests pin that guarantee.
const SETTINGS: ViewSettings = {
  fontSize: 13,
  charset: " .:-=+*#%@",
  light: [0.4, 0.6, -1],
  zoom: 1,
  speed: 1,
  autoRotate: true,
  samples: 160,
  samplesV: 0,
  theme: THEMES[0],
  spin: [0.6, 1.0, 0.25],
  paused: false,
  timeScale: 1,
  projection: "perspective",
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
  debug: false,
  demoDwell: 8,
  gridOverlay: false,
  pngScale: 1,
  pngTransparent: false,
  colorMode: "ramp",
};

const ANGLES: [number, number, number] = [0.6, 0.4, 0];
const sig = (
  s: ViewSettings = SETTINGS,
  a: [number, number, number] = ANGLES,
  cols = 134,
  rows = 53,
) => viewSig(cols, rows, a, s);

describe("viewSig (idle-skip frame signature)", () => {
  it("is stable for identical inputs", () => {
    expect(sig()).toBe(sig());
  });

  it("changes when a drawn-frame input changes", () => {
    const mutations: Array<(s: ViewSettings) => void> = [
      (s) => {
        s.zoom = 1.1;
      },
      (s) => {
        s.fov = 2.5;
      },
      (s) => {
        s.camDist = 4.5;
      },
      (s) => {
        s.projection = "ortho";
      },
      (s) => {
        s.light = [0.5, 0.6, -1];
      },
      (s) => {
        s.ambient = 0.2;
      },
      (s) => {
        s.diffuse = 0.9;
      },
      (s) => {
        s.specular = 0.5;
      },
      (s) => {
        s.shininess = 8;
      },
      (s) => {
        s.pointSize = 2;
      },
      (s) => {
        s.jitter = 0.5;
      },
      (s) => {
        s.persistence = 0.5;
      },
      (s) => {
        s.fog = 0.3;
      },
      (s) => {
        s.samples = 128;
      },
      (s) => {
        s.samplesV = 100;
      },
      (s) => {
        s.charset = " .oO@";
      },
      (s) => {
        s.theme = THEMES[1];
      },
      (s) => {
        s.colorMode = "rainbow";
      },
    ];
    for (const mutate of mutations) {
      const s = { ...SETTINGS };
      mutate(s);
      expect(sig(s), `signature must react to ${String(mutate)}`).not.toBe(sig());
    }
  });

  it("changes when angles or grid size change", () => {
    expect(sig(SETTINGS, [0.7, 0.4, 0])).not.toBe(sig());
    expect(sig(SETTINGS, ANGLES, 120, 53)).not.toBe(sig());
    expect(sig(SETTINGS, ANGLES, 134, 40)).not.toBe(sig());
  });

  it("ignores fields that cannot alter a frame", () => {
    const s = { ...SETTINGS, debug: !SETTINGS.debug, speed: 2, paused: !SETTINGS.paused };
    // time-advance inputs (speed/paused) only matter for non-static geometry,
    // which the separate static-geometry gate covers
    expect(sig(s)).toBe(sig());
  });
});
