/**
 * Hand-rolled argument parser — zero dependencies, one flag table. Accepts
 * `--flag value` and `--flag=value`; a value token is anything that doesn't
 * start with `--` (so `--zoom -0.5` works). `--set key=value` is repeatable.
 */

type Vec2 = [number, number];

export interface CliOptions {
  // shape
  shape: string | null;
  set: Array<[string, number]>;
  state: string | null;
  list: string | null;
  // style
  theme: string | null;
  charset: string | null;
  color: "ramp" | "rainbow" | "plasma" | null;
  noColor: boolean;
  bg: boolean | null; // null = mode default (on)
  // view
  zoom: number | null;
  angle: [number, number, number] | null;
  spin: [number, number, number] | null;
  noSpin: boolean;
  speed: number | null;
  fov: number | null;
  camDist: number | null;
  ortho: boolean;
  light: [number, number, number] | null;
  ambient: number | null;
  diffuse: number | null;
  specular: number | null;
  shininess: number | null;
  pointSize: number | null;
  jitter: number | null;
  persistence: number | null;
  fog: number | null;
  samples: number | null;
  samplesV: number | null;
  aspect: number | null;
  cols: number | null;
  rows: number | null;
  // live
  fps: number | null;
  mouse: Vec2 | null;
  pointerAuto: boolean;
  debug: boolean;
  // snapshot
  once: boolean;
  time: number | null;
  warmup: number | null;
  format: "txt" | "ansi" | "html" | "svg" | null;
  out: string | null;
  // meta
  help: boolean;
  version: boolean;
}

function emptyOptions(): CliOptions {
  return {
    shape: null,
    set: [],
    state: null,
    list: null,
    theme: null,
    charset: null,
    color: null,
    noColor: false,
    bg: null,
    zoom: null,
    angle: null,
    spin: null,
    noSpin: false,
    speed: null,
    fov: null,
    camDist: null,
    ortho: false,
    light: null,
    ambient: null,
    diffuse: null,
    specular: null,
    shininess: null,
    pointSize: null,
    jitter: null,
    persistence: null,
    fog: null,
    samples: null,
    samplesV: null,
    aspect: null,
    cols: null,
    rows: null,
    fps: null,
    mouse: null,
    pointerAuto: false,
    debug: false,
    once: false,
    time: null,
    warmup: null,
    format: null,
    out: null,
    help: false,
    version: false,
  };
}

type Kind = "str" | "opt-str" | "num" | "vec2" | "vec3" | "bool" | "param" | "enum";

interface FlagDef {
  kind: Kind;
  enum?: readonly string[];
}

const FLAGS: Record<string, FlagDef> = {
  shape: { kind: "str" },
  set: { kind: "param" },
  state: { kind: "str" },
  list: { kind: "opt-str" },
  theme: { kind: "str" },
  charset: { kind: "str" },
  color: { kind: "enum", enum: ["ramp", "rainbow", "plasma"] },
  "no-color": { kind: "bool" },
  bg: { kind: "bool" },
  "no-bg": { kind: "bool" },
  zoom: { kind: "num" },
  angle: { kind: "vec3" },
  spin: { kind: "vec3" },
  "no-spin": { kind: "bool" },
  speed: { kind: "num" },
  fov: { kind: "num" },
  "cam-dist": { kind: "num" },
  ortho: { kind: "bool" },
  light: { kind: "vec3" },
  ambient: { kind: "num" },
  diffuse: { kind: "num" },
  specular: { kind: "num" },
  shininess: { kind: "num" },
  "point-size": { kind: "num" },
  jitter: { kind: "num" },
  persistence: { kind: "num" },
  fog: { kind: "num" },
  samples: { kind: "num" },
  "samples-v": { kind: "num" },
  aspect: { kind: "num" },
  cols: { kind: "num" },
  rows: { kind: "num" },
  fps: { kind: "num" },
  mouse: { kind: "vec2" },
  "pointer-auto": { kind: "bool" },
  debug: { kind: "bool" },
  once: { kind: "bool" },
  time: { kind: "num" },
  warmup: { kind: "num" },
  format: { kind: "enum", enum: ["txt", "ansi", "html", "svg"] },
  out: { kind: "str" },
  help: { kind: "bool" },
  version: { kind: "bool" },
};

export type ParseResult = { opts: CliOptions; error: null } | { opts: null; error: string };

function num(raw: string, flag: string): number | string {
  // Number("") and Number(" ") are 0 — a blank value must be an error, not a silent 0
  if (raw.trim() === "") return `--${flag} expects a number (got "${raw}")`;
  const v = Number(raw);
  if (!Number.isFinite(v)) return `--${flag} expects a number (got "${raw}")`;
  return v;
}

function vec(raw: string, flag: string, len: number): [number, ...number[]] | string {
  const parts = raw.split(",");
  if (parts.length !== len || parts.some((p) => p.trim() === "" || !Number.isFinite(Number(p)))) {
    return `--${flag} expects ${len} comma-separated numbers (got "${raw}")`;
  }
  return parts.map(Number) as [number, ...number[]];
}

export function parseArgs(argv: string[]): ParseResult {
  const opts = emptyOptions();
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i++];
    if (!tok.startsWith("--"))
      return { opts: null, error: `unexpected argument "${tok}" — see --help` };
    const eq = tok.indexOf("=");
    const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
    const inline = eq === -1 ? null : tok.slice(eq + 1);
    const def = FLAGS[name];
    if (!def) return { opts: null, error: `unknown flag --${name} — see --help` };

    if (def.kind === "bool") {
      if (inline !== null) return { opts: null, error: `--${name} takes no value` };
      assignBool(opts, name);
      continue;
    }

    let raw: string;
    if (def.kind === "opt-str") {
      raw = inline ?? (i < argv.length && !argv[i].startsWith("--") ? argv[i++] : "");
    } else {
      if (inline !== null) raw = inline;
      else {
        const next = i < argv.length ? argv[i] : null;
        if (next === null || next.startsWith("--"))
          return { opts: null, error: `--${name} requires a value` };
        raw = next;
        i++;
      }
    }

    let parsed: string | number | [number, ...number[]];
    switch (def.kind) {
      case "str":
        parsed = raw;
        break;
      case "opt-str":
        parsed = raw;
        break;
      case "num": {
        const v = num(raw, name);
        if (typeof v === "string") return { opts: null, error: v };
        parsed = v;
        break;
      }
      case "vec2":
      case "vec3": {
        const v = vec(raw, name, def.kind === "vec2" ? 2 : 3);
        if (typeof v === "string") return { opts: null, error: v };
        parsed = v;
        break;
      }
      case "enum":
        if (!def.enum!.includes(raw))
          return { opts: null, error: `--${name} must be one of: ${def.enum!.join(", ")}` };
        parsed = raw;
        break;
      case "param": {
        const eqAt = raw.indexOf("=");
        if (eqAt === -1) return { opts: null, error: `--${name} expects key=value (got "${raw}")` };
        const key = raw.slice(0, eqAt);
        if (key.trim() === "")
          return { opts: null, error: `--${name} expects key=value (got "${raw}")` };
        const valueRaw = raw.slice(eqAt + 1);
        const v = num(valueRaw, name);
        if (typeof v === "string") return { opts: null, error: v };
        opts.set.push([key, v]);
        continue;
      }
      default:
        return { opts: null, error: `internal: unhandled flag kind for --${name}` };
    }
    assignValue(opts, name, parsed);
  }
  return { opts, error: null };
}

function assignBool(opts: CliOptions, name: string): void {
  switch (name) {
    case "no-color":
      opts.noColor = true;
      break;
    case "bg":
      opts.bg = true;
      break;
    case "no-bg":
      opts.bg = false;
      break;
    case "no-spin":
      opts.noSpin = true;
      break;
    case "ortho":
      opts.ortho = true;
      break;
    case "pointer-auto":
      opts.pointerAuto = true;
      break;
    case "debug":
      opts.debug = true;
      break;
    case "once":
      opts.once = true;
      break;
    case "help":
      opts.help = true;
      break;
    case "version":
      opts.version = true;
      break;
  }
}

function assignValue(
  opts: CliOptions,
  name: string,
  v: string | number | [number, ...number[]],
): void {
  switch (name) {
    case "shape":
      opts.shape = v as string;
      break;
    case "state":
      opts.state = v as string;
      break;
    case "list":
      opts.list = (v as string) || "shapes";
      break;
    case "theme":
      opts.theme = v as string;
      break;
    case "charset":
      opts.charset = v as string;
      break;
    case "color":
      opts.color = v as CliOptions["color"];
      break;
    case "zoom":
      opts.zoom = v as number;
      break;
    case "angle":
      opts.angle = v as [number, number, number];
      break;
    case "spin":
      opts.spin = v as [number, number, number];
      break;
    case "speed":
      opts.speed = v as number;
      break;
    case "fov":
      opts.fov = v as number;
      break;
    case "cam-dist":
      opts.camDist = v as number;
      break;
    case "light":
      opts.light = v as [number, number, number];
      break;
    case "ambient":
      opts.ambient = v as number;
      break;
    case "diffuse":
      opts.diffuse = v as number;
      break;
    case "specular":
      opts.specular = v as number;
      break;
    case "shininess":
      opts.shininess = v as number;
      break;
    case "point-size":
      opts.pointSize = v as number;
      break;
    case "jitter":
      opts.jitter = v as number;
      break;
    case "persistence":
      opts.persistence = v as number;
      break;
    case "fog":
      opts.fog = v as number;
      break;
    case "samples":
      opts.samples = v as number;
      break;
    case "samples-v":
      opts.samplesV = v as number;
      break;
    case "aspect":
      opts.aspect = v as number;
      break;
    case "cols":
      opts.cols = v as number;
      break;
    case "rows":
      opts.rows = v as number;
      break;
    case "fps":
      opts.fps = v as number;
      break;
    case "mouse":
      opts.mouse = v as Vec2;
      break;
    case "time":
      opts.time = v as number;
      break;
    case "warmup":
      opts.warmup = v as number;
      break;
    case "format":
      opts.format = v as CliOptions["format"];
      break;
    case "out":
      opts.out = v as string;
      break;
  }
}

export const usageText = `ascii-surf — real-time 3D ASCII art in the terminal (donut.c lineage)

Usage:
  npm run cli -- <flags>          # from the repo root
  ascii-surf <flags>              # built binary (npm run build:cli)

Modes:
  live (default)   full-screen animated renderer; keyboard orbit, mouse tracking
  --once           render a single frame and exit (pipe-friendly)

Shape:
  --shape <id|name|index>   pick a shape ("lorenz", "torus knot", 17)
  --set <key=value>         set a native shape parameter (repeatable)
  --state <base64url>       load a web share-link scene (the part after #s=)
  --list [shapes|themes|charsets]

View:
  --cols N --rows N         grid size (default: terminal size, or 100x40 piped)
  --zoom N --angle x,y,z --spin x,y,z --no-spin --speed N
  --fov N --cam-dist N --ortho
  --light x,y,z --ambient N --diffuse N --specular N --shininess N
  --point-size N --jitter N --persistence N --fog N
  --samples N --samples-v N --aspect N      cell height/width (default 2)

Style:
  --theme <name>            one of --list themes
  --charset <name|glyphs>   built-in name or any glyph string
  --color ramp|rainbow|plasma
  --bg / --no-bg            paint the theme background (default: on)

Live:
  --fps N                   target frame rate (default 30)
  --mouse x,y               fixed pointer position 0..1 (shader shapes)
  --pointer-auto            sweep the pointer automatically (no mouse needed)
  --debug                   status line (fps, ms, points, grid)

Snapshot (--once):
  --time t                  surface time for the captured frame
  --warmup N                advance N frames first (develops simulations)
  --format txt|ansi|html|svg  (default: ansi on a terminal, txt when piped)
  --out <file>              write to a file instead of stdout
  --no-color                plain text output

Keys (live):
  q/Esc quit · space pause · arrows orbit · +/- zoom · 1-9 presets
  n/p next/prev shape · t theme · c charset · m color mode · o projection
  r reset view · s auto-spin · f fog · x randomize · d debug
`;
