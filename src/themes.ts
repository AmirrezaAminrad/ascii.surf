/**
 * Built-in themes: a name and three colors. Themes recolor the scene only —
 * the charset is a separate setting and is never touched on switch.
 * Also home to user-built custom themes (localStorage persistence) and the
 * random draft generator the Theme-section editor uses.
 */
import { hslToRgb } from "./engine/exports";

export interface Theme {
  name: string;
  bg: string;
  fg: string; // base color
  glow: string;
  mode: "mono" | "heat";
}

export const THEMES: Theme[] = [
  { name: "Phosphor", bg: "#050a06", fg: "#39ff6a", glow: "#d8ffe0", mode: "heat" },
  { name: "Amber", bg: "#0b0703", fg: "#ffb000", glow: "#fff2c4", mode: "heat" },
  { name: "Plasma", bg: "#07040f", fg: "#c23bff", glow: "#ffe6ff", mode: "heat" },
  { name: "Ice", bg: "#030810", fg: "#3fb8ff", glow: "#e8fbff", mode: "heat" },
  { name: "Vapor", bg: "#0d0518", fg: "#ff6ad5", glow: "#ffe8fb", mode: "heat" },
  { name: "Acid", bg: "#0a0c02", fg: "#c8ff3e", glow: "#f4ffe0", mode: "heat" },
  { name: "Ember", bg: "#0c0502", fg: "#ff5c33", glow: "#ffe4d4", mode: "heat" },
  { name: "Paper", bg: "#f4f1ea", fg: "#1a1a1a", glow: "#1a1a1a", mode: "mono" },
  { name: "Mono", bg: "#000000", fg: "#e5e5e5", glow: "#ffffff", mode: "mono" },
  { name: "Gameboy", bg: "#0f380f", fg: "#8bac0f", glow: "#c4d426", mode: "mono" },
  { name: "Sakura", bg: "#170a12", fg: "#ffb7d5", glow: "#ffe4f1", mode: "heat" },
  { name: "Ultraviolet", bg: "#0b0616", fg: "#a78bfa", glow: "#f2ecff", mode: "heat" },
];

// --- custom themes (user-built in the Theme section, persisted locally) -----

const CUSTOM_THEMES_KEY = "ascii-surf-themes-v1";
export const CUSTOM_THEMES_MAX = 12;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** User-built themes; malformed entries are dropped and names de-duplicated. */
export function loadCustomThemes(): Theme[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Theme[] = [];
    for (const t of raw as Theme[]) {
      if (
        typeof t?.name === "string" &&
        t.name.trim() !== "" &&
        !seen.has(t.name) &&
        HEX_RE.test(t.bg) &&
        HEX_RE.test(t.fg) &&
        HEX_RE.test(t.glow) &&
        (t.mode === "heat" || t.mode === "mono")
      ) {
        seen.add(t.name);
        out.push({ name: t.name.slice(0, 24), bg: t.bg, fg: t.fg, glow: t.glow, mode: t.mode });
      }
      if (out.length >= CUSTOM_THEMES_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function persistCustomThemes(list: Theme[]) {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

/** In-progress theme being built in the Theme section editor. */
export interface ThemeDraft {
  name: string;
  bg: string;
  fg: string;
  glow: string;
  mode: "heat" | "mono";
}

const DRAFT_WORDS = [
  "Nova",
  "Reef",
  "Dune",
  "Frost",
  "Moss",
  "Opal",
  "Vesper",
  "Zenith",
  "Lumen",
  "Tide",
];

/** A coherent random phosphor palette: saturated fg hue, pale glow, near-black tinted bg. */
export function shuffledDraft(): ThemeDraft {
  const h = Math.floor(Math.random() * 360);
  const hsl = (hh: number, s: number, l: number): string => {
    const [r, g, b] = hslToRgb(((hh % 360) + 360) % 360, s, l);
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  return {
    name: `${DRAFT_WORDS[Math.floor(Math.random() * DRAFT_WORDS.length)]} ${Math.floor(Math.random() * 90 + 10)}`,
    bg: hsl(h + 210, 0.45, 0.03),
    fg: hsl(h, 0.9, 0.6),
    glow: hsl(h + 15, 0.75, 0.88),
    mode: "heat",
  };
}
