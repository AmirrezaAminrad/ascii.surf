import { Fragment } from "react";

/** Full-screen keyboard-shortcut reference, opened by the ? key / header button. */

const SHORTCUT_GROUPS: [string, [string[], string][]][] = [
  [
    "view",
    [
      [["drag"], "rotate (inertia on release)"],
      [["scroll", "pinch"], "zoom"],
      [["←", "→", "↑", "↓"], "nudge rotation"],
      [["+", "−"], "zoom in / out"],
      [["R"], "reset view"],
      [["O"], "perspective / ortho"],
      [["F"], "fullscreen"],
      [["G"], "debug readout"],
      [["H"], "toggle panel"],
    ],
  ],
  [
    "time & shapes",
    [
      [["Space"], "pause / resume time"],
      [["1", "…", "9"], "load shape from the registry"],
      [["D"], "demo: cycle shapes in the category"],
      [["X"], "randomize shape + params + theme"],
      [["M"], "import STL / OBJ mesh — drop a .json to import a scene"],
    ],
  ],
  [
    "edit",
    [
      [["ctrl", "K"], "command palette — jump to shapes, themes, actions"],
      [["ctrl", "Z"], "undo a tweak (params, settings, shape)"],
      [["ctrl", "⇧", "Z"], "redo — or ctrl + Y"],
    ],
  ],
  [
    "export",
    [
      [["C"], "copy frame as text"],
      [["⇧C"], "copy frame as a PNG image"],
      [["A"], "copy ANSI truecolor frame"],
      [["P"], "save PNG"],
      [["S"], "save vector .svg"],
      [["T"], "save frame .txt"],
      [["E"], "save animated GIF"],
      [["V"], "record webm video"],
      [["L"], "copy share link"],
    ],
  ],
  [
    "help",
    [
      [["?"], "toggle this overlay"],
      [["esc"], "close this overlay"],
    ],
  ],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="anim-pop max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/15 bg-[#0b0b0e] p-5 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="-mx-5 -mt-5 mb-4 h-px"
          aria-hidden="true"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(110,231,183,0.55), transparent)",
          }}
        />
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/50">
            keyboard shortcuts
          </div>
          <button
            onClick={onClose}
            aria-label="close shortcuts"
            className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:text-white"
          >
            esc
          </button>
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map(([group, rows]) => (
            <div key={group}>
              <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.3em] text-emerald-300/60">
                <span className="inline-block h-[2px] w-[2px] rounded-full bg-emerald-300/80 shadow-[0_0_5px_rgba(110,231,183,0.9)]" />
                {group}
              </div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[11.5px]">
                {rows.map(([keys, label], i) => (
                  <Fragment key={i}>
                    <div className="flex gap-1">
                      {keys.map((k) => (
                        <span key={k} className="kbd">
                          {k}
                        </span>
                      ))}
                    </div>
                    <div className="text-white/70">{label}</div>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/35">
          The code presets are editable code with every Math function in scope, plus time as{" "}
          <span className="text-white/60">t</span> — height fields are z = f(x, y, t), parametric
          surfaces are (u, v, t) → [x, y, z]. Registry shapes expose parameter sliders instead. Tap
          the ☆ on a shape to pin it — the <span className="text-white/60">★</span> chip scopes the
          grid and demo to your pins.
          <span className="text-white/60"> ctrl + K</span> opens the command palette — fuzzy-jump to
          any shape, theme or action. Themes change colors only — pick your charset separately;
          build your own theme via
          <span className="text-white/60"> Theme → + custom</span> (⚄ shuffles a coherent palette).
          Panel sections collapse via their headers; drag the panel's left edge to resize it
          (double-click resets); <span className="text-white/60">⚄ re-roll</span> shuffles the
          current shape's sliders.
        </p>
      </div>
    </div>
  );
}
