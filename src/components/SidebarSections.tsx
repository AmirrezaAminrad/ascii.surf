import { CHARSETS } from "../engine/presets";
import type { ColorMode } from "../engine/exports";
import type { Scene } from "../state";
import { shuffledDraft, type Theme, type ThemeDraft } from "../themes";
import type { ViewApi, ViewSettings } from "../types";
import { ZOOM_MAX, ZOOM_MIN } from "../view";
import { Section, Segmented, Slider, Switch } from "./Controls";
import { TimeReadout } from "./StatusBar";

/**
 * Presentational sidebar sections that read only props (settings + callbacks).
 * All colors come from the CSS variables App sets per theme, so the components
 * stay theme-agnostic. The Shape/Parameters/code sections stay in App — they
 * close over too much live state to be worth the prop threading.
 */

type Patch = (p: Partial<ViewSettings>) => void;

export function ViewSections({
  settings,
  patch,
  accent,
  apiRef,
  recDur,
  setRecDur,
}: {
  settings: ViewSettings;
  patch: Patch;
  accent: string;
  apiRef: React.MutableRefObject<ViewApi | null>;
  recDur: number;
  setRecDur: (v: number) => void;
}) {
  return (
    <>
      <Section title="Rotation" icon="⟳">
        <div className="mb-2.5 flex items-center justify-between text-[11px]">
          <span className="text-[var(--panel-dim)]">auto-rotate</span>
          <Switch
            checked={settings.autoRotate}
            onChange={(v) => patch({ autoRotate: v })}
            label="auto-rotate"
          />
        </div>
        <Slider
          label="speed"
          value={settings.speed}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) => patch({ speed: v })}
          fmt={(v) => v.toFixed(2) + "×"}
        />
        <Slider
          label="spin x"
          value={settings.spin[0]}
          min={-2}
          max={2}
          step={0.05}
          onChange={(v) => patch({ spin: [v, settings.spin[1], settings.spin[2]] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="spin y"
          value={settings.spin[1]}
          min={-2}
          max={2}
          step={0.05}
          onChange={(v) => patch({ spin: [settings.spin[0], v, settings.spin[2]] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="spin z"
          value={settings.spin[2]}
          min={-2}
          max={2}
          step={0.05}
          onChange={(v) => patch({ spin: [settings.spin[0], settings.spin[1], v] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="zoom"
          value={settings.zoom}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          onChange={(v) => patch({ zoom: v })}
          fmt={(v) => v.toFixed(2) + "×"}
        />
      </Section>

      <Section
        title="Time"
        icon="◷"
        right={
          <span className="font-mono text-[10px] tabular-nums text-[var(--panel-head)]">
            <TimeReadout />
          </span>
        }
      >
        <div className="mb-2.5 flex items-center justify-between text-[11px]">
          <span className="text-[var(--panel-dim)]">{settings.paused ? "paused" : "running"}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => apiRef.current?.resetTime()}
              title="restart t at zero"
              className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:text-[var(--panel-text)]"
            >
              reset
            </button>
            <Switch
              checked={!settings.paused}
              onChange={(v) => patch({ paused: !v })}
              label="run surface time"
            />
          </div>
        </div>
        <Slider
          label="time scale"
          value={settings.timeScale}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => patch({ timeScale: v })}
          fmt={(v) => v.toFixed(2) + "×"}
        />
        <Slider
          label="demo dwell"
          value={settings.demoDwell}
          min={2}
          max={30}
          step={1}
          onChange={(v) => patch({ demoDwell: v })}
          fmt={(v) => v.toFixed(0) + "s"}
        />
        <Slider
          label="record length"
          value={recDur}
          min={1}
          max={30}
          step={1}
          onChange={setRecDur}
          fmt={(v) => v.toFixed(0) + "s webm"}
        />
        <p className="text-[10px] leading-snug text-[var(--panel-dimmer)]">
          Animations advance with <span className="text-[var(--panel-dim)]">t</span> — pause with
          Space. Demo cycles the shapes in the active category.
        </p>
      </Section>

      <Section title="Camera" icon="▣">
        <Segmented
          options={["perspective", "ortho"]}
          value={settings.projection}
          onChange={(k) => patch({ projection: k as "perspective" | "ortho" })}
          label="projection"
          cols={2}
        />
        <Slider
          label="field of view"
          value={settings.fov}
          min={1.2}
          max={4.8}
          step={0.05}
          onChange={(v) => patch({ fov: v })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="camera distance"
          value={settings.camDist}
          min={2.5}
          max={12}
          step={0.1}
          onChange={(v) => patch({ camDist: v })}
          fmt={(v) => v.toFixed(1)}
        />
        <p className="text-[10px] leading-snug text-[var(--panel-dimmer)]">
          Orientation is the object rotation — the camera stays on the z axis.
        </p>
      </Section>

      <Section title="Light" icon="✦">
        <Slider
          label="light x"
          value={settings.light[0]}
          min={-1}
          max={1}
          step={0.05}
          onChange={(v) => patch({ light: [v, settings.light[1], settings.light[2]] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="light y"
          value={settings.light[1]}
          min={-1}
          max={1}
          step={0.05}
          onChange={(v) => patch({ light: [settings.light[0], v, settings.light[2]] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="light z"
          value={settings.light[2]}
          min={-1}
          max={1}
          step={0.05}
          onChange={(v) => patch({ light: [settings.light[0], settings.light[1], v] })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="ambient"
          value={settings.ambient}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => patch({ ambient: v })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="diffuse"
          value={settings.diffuse}
          min={0}
          max={1.5}
          step={0.02}
          onChange={(v) => patch({ diffuse: v })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="specular"
          value={settings.specular}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => patch({ specular: v })}
          fmt={(v) => v.toFixed(2)}
        />
        <Slider
          label="shininess"
          value={settings.shininess}
          min={2}
          max={64}
          step={1}
          onChange={(v) => patch({ shininess: v })}
          fmt={(v) => String(Math.round(v))}
        />
        <Slider
          label="depth fog"
          value={settings.fog}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => patch({ fog: v })}
          fmt={(v) => (v === 0 ? "off" : Math.round(v * 100) + "%")}
        />
      </Section>

      <Section title="Raster" icon="▦">
        <Slider
          label="font size"
          value={settings.fontSize}
          min={6}
          max={28}
          step={1}
          onChange={(v) => patch({ fontSize: v })}
          fmt={(v) => v + "px"}
        />
        <div className="mb-1 text-[11px] text-[var(--panel-dim)]">color mode</div>
        <Segmented
          options={["ramp", "rainbow", "plasma"]}
          value={settings.colorMode}
          onChange={(k) => patch({ colorMode: k as ColorMode })}
          label="color mode"
          cols={3}
        />
        <Slider
          label="samples u (width)"
          value={settings.samples}
          min={40}
          max={400}
          step={10}
          onChange={(v) => patch({ samples: v })}
        />
        <div className="mb-2.5 flex items-center justify-between text-[11px]">
          <span className="text-[var(--panel-dim)]">square grid</span>
          <Switch
            checked={settings.samplesV === 0}
            onChange={(v) =>
              patch({
                samplesV: v ? 0 : Math.max(40, Math.round((settings.samples * 0.75) / 10) * 10),
              })
            }
            label="square sample grid"
          />
        </div>
        {settings.samplesV > 0 && (
          <Slider
            label="samples v (height)"
            value={settings.samplesV}
            min={40}
            max={400}
            step={10}
            onChange={(v) => patch({ samplesV: v })}
          />
        )}
        <div className="mb-1 text-[11px] text-[var(--panel-dim)]">point size</div>
        <Segmented
          options={["1×", "2×", "3×"]}
          value={`${settings.pointSize}×`}
          onChange={(v) => patch({ pointSize: parseInt(v, 10) || 1 })}
          label="point size"
          cols={3}
        />
        <Slider
          label="jitter"
          value={settings.jitter}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => patch({ jitter: v })}
          fmt={(v) => (v === 0 ? "off" : Math.round(v * 100) + "%")}
        />
        <Slider
          label="phosphor persistence"
          value={settings.persistence}
          min={0}
          max={0.95}
          step={0.05}
          onChange={(v) => patch({ persistence: v })}
          fmt={(v) => (v === 0 ? "off" : Math.round(v * 100) + "%")}
        />
        <div className="mb-1 mt-1 border-t border-[var(--panel-line)] pt-2 text-[11px] text-[var(--panel-dim)]">
          png export
        </div>
        <Segmented
          options={["1×", "2×", "3×"]}
          value={`${settings.pngScale}×`}
          onChange={(v) => patch({ pngScale: parseInt(v, 10) || 1 })}
          label="png export scale"
          cols={3}
        />
        <div className="mb-2.5 flex items-center justify-between text-[11px]">
          <span className="text-[var(--panel-dim)]">transparent background</span>
          <Switch
            checked={settings.pngTransparent}
            onChange={(v) => patch({ pngTransparent: v })}
            label="transparent png background"
          />
        </div>
        <div className="mb-1 border-t border-[var(--panel-line)] pt-2 text-[11px] text-[var(--panel-dim)]">
          viewport overlay
        </div>
        <div className="mb-2.5 flex items-center justify-between text-[11px]">
          <span className="text-[var(--panel-dim)]">cell grid overlay</span>
          <Switch
            checked={settings.gridOverlay}
            onChange={(v) => patch({ gridOverlay: v })}
            label="character cell grid overlay"
          />
        </div>
        <div className="mb-1 text-[11px] text-[var(--panel-dim)]">charset</div>
        <div className="flex flex-wrap gap-1">
          {CHARSETS.map((c) => {
            const active = settings.charset === c.chars;
            return (
              <button
                key={c.name}
                onClick={() => patch({ charset: c.chars })}
                title={c.chars.length > 24 ? c.chars.slice(0, 24) + "…" : c.chars}
                aria-pressed={active}
                className="rounded border px-1.5 py-0.5 text-[11px] transition-all duration-150 hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-[0.97]"
                style={
                  active
                    ? {
                        borderColor: accent,
                        color: accent,
                        background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                      }
                    : { borderColor: "var(--panel-chip)", color: "var(--panel-dim)" }
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <input
          value={settings.charset}
          onChange={(e) => patch({ charset: e.target.value })}
          className="mt-2 w-full rounded border border-[var(--panel-line)] bg-[var(--panel-input)] px-2 py-1 font-mono text-[12px] text-[var(--panel-text)] outline-none transition-colors hover:border-[var(--panel-dim)] focus:border-current"
          title="dark → bright"
          aria-label="custom charset"
        />
      </Section>
    </>
  );
}

export function ScenesSection({
  scenes,
  sceneName,
  setSceneName,
  saveScene,
  loadScene,
  deleteScene,
  exportScene,
  sceneInputRef,
  accent,
}: {
  scenes: Scene[];
  sceneName: string;
  setSceneName: (v: string) => void;
  saveScene: () => void;
  loadScene: (sc: Scene) => void;
  deleteScene: (name: string) => void;
  exportScene: (sc: Scene) => void;
  sceneInputRef: React.MutableRefObject<HTMLInputElement | null>;
  accent: string;
}) {
  return (
    <Section
      title="Scenes"
      icon="⚑"
      right={
        <button
          onClick={() => sceneInputRef.current?.click()}
          title="load a scene from a .json file"
          className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)]"
        >
          import
        </button>
      }
    >
      <div className="flex gap-1">
        <input
          value={sceneName}
          onChange={(e) => setSceneName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveScene();
          }}
          placeholder="scene name…"
          aria-label="scene name"
          className="min-w-0 flex-1 rounded border border-[var(--panel-line)] bg-[var(--panel-input)] px-2 py-1 font-mono text-[11px] text-[var(--panel-text)] outline-none transition-colors placeholder:text-[var(--panel-dimmer)] hover:border-[var(--panel-dim)] focus:border-current"
        />
        <button
          onClick={saveScene}
          title="snapshot the current shape, code, view and theme"
          className="rounded border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors"
          style={{ borderColor: accent + "66", color: accent }}
        >
          save
        </button>
      </div>
      {scenes.length > 0 ? (
        <div className="mt-2 flex flex-col gap-0.5">
          {scenes.map((sc) => (
            <div
              key={sc.name + String(sc.ts)}
              className="group relative flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-[11px] transition-colors hover:border-[var(--panel-line)] hover:bg-[var(--panel-track)]"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-[var(--acc)] opacity-0 shadow-[0_0_6px_var(--acc)] transition-opacity duration-150 group-hover:opacity-80"
              />
              <button
                onClick={() => loadScene(sc)}
                className="min-w-0 flex-1 truncate text-left text-[var(--panel-text)] transition-colors hover:text-[var(--acc)]"
                title={`load "${sc.name}"`}
              >
                {sc.name}
              </button>
              <span className="text-[9px] tabular-nums text-[var(--panel-dimmer)]">
                {new Date(sc.ts).toLocaleDateString()}
              </span>
              <button
                onClick={() => exportScene(sc)}
                title="export scene as .json"
                className="px-1 text-[var(--panel-dim)] opacity-0 transition-all hover:text-[var(--panel-text)] group-hover:opacity-100"
              >
                ⤓
              </button>
              <button
                onClick={() => deleteScene(sc.name)}
                title="delete scene"
                className="px-1 text-[var(--panel-dim)] opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-snug text-[var(--panel-dimmer)]">
          Snapshot shape + code + view + theme as a named scene. Scenes live in this browser; ⤓
          exports a .json you can re-import.
        </p>
      )}
    </Section>
  );
}

export function ThemeSection({
  settings,
  allThemesList,
  customThemes,
  themeDraft,
  setThemeDraft,
  saveTheme,
  deleteTheme,
  applyTheme,
  accent,
}: {
  settings: ViewSettings;
  allThemesList: Theme[];
  customThemes: Theme[];
  themeDraft: ThemeDraft | null;
  setThemeDraft: (d: ThemeDraft | null) => void;
  saveTheme: () => void;
  deleteTheme: (name: string) => void;
  applyTheme: (t: Theme) => void;
  accent: string;
}) {
  return (
    <Section
      title="Theme"
      icon="◐"
      right={
        <button
          onClick={() => setThemeDraft(themeDraft ? null : shuffledDraft())}
          title={themeDraft ? "close the theme editor" : "build a custom theme"}
          aria-pressed={!!themeDraft}
          className="rounded border border-[var(--panel-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)]"
        >
          {themeDraft ? "close" : "+ custom"}
        </button>
      }
    >
      {themeDraft && (
        <div className="anim-pop mb-2 rounded-md border border-[var(--panel-line)] bg-[var(--panel-track)] p-2">
          <div className="mb-2 flex items-center gap-2">
            {(["bg", "fg", "glow"] as const).map((k) => (
              <label
                key={k}
                className="flex flex-1 cursor-pointer flex-col items-center gap-1"
                title={`${k} color`}
              >
                <input
                  type="color"
                  value={themeDraft[k]}
                  onChange={(e) => setThemeDraft({ ...themeDraft, [k]: e.target.value })}
                  className="h-6 w-full cursor-pointer rounded border border-[var(--panel-line)] bg-transparent p-0.5"
                  aria-label={`theme ${k} color`}
                />
                <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--panel-dimmer)]">
                  {k}
                </span>
              </label>
            ))}
          </div>
          <Segmented
            options={["heat", "mono"]}
            value={themeDraft.mode}
            onChange={(k) => setThemeDraft({ ...themeDraft, mode: k as "heat" | "mono" })}
            label="theme mode"
            cols={2}
          />
          <div className="mt-1.5 flex gap-1">
            <input
              value={themeDraft.name}
              onChange={(e) => setThemeDraft({ ...themeDraft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTheme();
              }}
              placeholder="theme name…"
              aria-label="custom theme name"
              className="min-w-0 flex-1 rounded border border-[var(--panel-line)] bg-[var(--panel-input)] px-2 py-1 text-[11px] text-[var(--panel-text)] outline-none transition-colors placeholder:text-[var(--panel-dimmer)] hover:border-[var(--panel-dim)] focus:border-current"
            />
            <button
              onClick={() => setThemeDraft(shuffledDraft())}
              title="shuffle a coherent random palette"
              aria-label="shuffle theme palette"
              className="rounded border border-[var(--panel-chip)] px-1.5 text-[11px] text-[var(--panel-dim)] transition-colors hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-95"
            >
              ⚄
            </button>
            <button
              onClick={saveTheme}
              title="save and apply this theme"
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors"
              style={{ borderColor: accent + "66", color: accent }}
            >
              save
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        {allThemesList.map((t) => {
          const active = settings.theme.name === t.name;
          const custom = customThemes.some((c) => c.name === t.name);
          return (
            <div key={t.name} className="group relative">
              <button
                onClick={() => applyTheme(t)}
                aria-pressed={active}
                title={`${t.name} — bg ${t.bg} · fg ${t.fg} · glow ${t.glow}${custom ? " · custom" : ""}`}
                className="group flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] transition-all duration-150 hover:border-[var(--panel-dim)] hover:text-[var(--panel-text)] active:scale-[0.97]"
                style={
                  active
                    ? { borderColor: accent, color: accent, boxShadow: `0 0 10px ${accent}22` }
                    : { borderColor: "var(--panel-chip)", color: "var(--panel-dim)" }
                }
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-white/25 transition-transform duration-200 group-hover:scale-110 hover:scale-125"
                  style={{
                    background: `linear-gradient(135deg, ${t.bg} 0%, ${t.fg} 60%, ${t.glow} 100%)`,
                  }}
                />
                <span className="min-w-0 truncate">{t.name}</span>
                {custom && (
                  <span aria-hidden="true" className="ml-auto text-[8px] opacity-60">
                    ✎
                  </span>
                )}
              </button>
              {custom && (
                <button
                  onClick={() => deleteTheme(t.name)}
                  title={`delete theme "${t.name}"`}
                  aria-label={`delete theme ${t.name}`}
                  className="absolute -right-1 -top-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--panel-line)] bg-[var(--panel-input)] text-[8px] leading-none text-[var(--panel-dim)] transition-colors hover:border-red-400/60 hover:text-red-300 group-hover:flex"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
