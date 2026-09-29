import { useEffect, useRef, useState } from "react";

/**
 * Presentational control primitives shared by the sidebar panels.
 * All colors come from the CSS variables the App sets per theme
 * (--acc, --panel-line, --panel-chip, …) so components stay theme-agnostic.
 */

const SECTION_LS_KEY = "ascii-surf-sections-v1";

function loadCollapsedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTION_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Sidebar section with a chevron + animated collapse. Collapsed state persists
 * per title in localStorage so the panel reopens the way it was left.
 */
export function Section({
  title,
  icon,
  children,
  right,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => !!loadCollapsedMap()[title]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      const map = loadCollapsedMap();
      if (next) map[title] = true;
      else delete map[title];
      localStorage.setItem(SECTION_LS_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="border-b border-[var(--panel-line)] px-4 py-3.5 transition-colors">
      <div className={`flex items-center justify-between ${collapsed ? "" : "mb-2.5"}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? `expand ${title}` : `collapse ${title}`}
          className="group -mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--panel-head)] transition-colors hover:text-[var(--panel-text)]"
        >
          <span
            aria-hidden="true"
            className="sect-chevron inline-block text-[8px] leading-none text-[var(--panel-dim)] transition-transform duration-200 group-hover:text-[var(--acc)]"
            style={{ transform: collapsed ? "none" : "rotate(90deg)" }}
          >
            ▶
          </span>
          {icon ? (
            <span
              className="w-3 text-center text-[11px] leading-none text-[var(--acc)] opacity-80"
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : (
            <span className="inline-block h-[3px] w-[3px] rounded-full bg-[var(--acc)] shadow-[0_0_6px_var(--acc)]" />
          )}
          {title}
        </button>
        {right}
      </div>
      <div
        className={`sect-body grid transition-[grid-template-rows] duration-200 ease-out ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
        aria-hidden={collapsed}
      >
        <div className="min-h-0 overflow-hidden" inert={collapsed}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Segmented control shared by the kind toggle, projection, and point-size rows. */
export function Segmented({
  options,
  labels,
  value,
  onChange,
  label,
  cols,
}: {
  options: readonly string[];
  labels?: Record<string, string>; // value → display text (defaults to the value)
  value: string;
  onChange: (v: string) => void;
  label: string;
  cols: number;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="mb-2 grid gap-0.5 rounded-md border border-[var(--panel-line)] p-0.5 text-[9.5px] uppercase tracking-wider"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        background: "var(--panel-track)",
      }}
    >
      {options.map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={active}
            className="truncate rounded py-1 transition-all duration-150"
            style={
              active
                ? {
                    background: "color-mix(in srgb, var(--acc) 18%, transparent)",
                    color: "var(--acc)",
                    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--acc) 40%, transparent)",
                  }
                : { color: "var(--panel-dim)" }
            }
          >
            {labels?.[k] ?? k}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const txt = fmt ? fmt(value) : String(value);
  // coalesce input events to one commit per frame: a drag fires ~60 onChange/s
  // and each commit re-renders the whole panel + re-keys the engine caches
  const pending = useRef<number | null>(null);
  const latest = useRef(value);
  const commit = (v: number) => {
    latest.current = v;
    if (pending.current !== null) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      onChange(latest.current);
    });
  };
  useEffect(
    () => () => {
      if (pending.current !== null) cancelAnimationFrame(pending.current);
    },
    [],
  );
  return (
    <label className="group mb-2.5 block">
      <div className="flex items-baseline justify-between text-[11px] text-[var(--panel-dim)] transition-colors group-hover:text-[var(--panel-hi)]">
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
        <span className="tabular-nums text-[var(--panel-text)] transition-colors group-hover:text-[var(--acc)]">
          {txt}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={txt}
        onChange={(e) => commit(parseFloat(e.target.value))}
        className="mt-1.5 w-full"
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, var(--acc) 75%, transparent) ${pct}%, var(--panel-track) ${pct}%)`,
        }}
      />
    </label>
  );
}

export function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  // don't snap the text back while the user is mid-edit
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setTxt(String(+value.toFixed(4)));
  }, [value]);
  // pi/tau shorthand in a single pass so replacements are never re-matched: "2pi" → 2*Math.PI
  const toExpr = (raw: string) =>
    raw.replace(/(\d+(?:\.\d+)?)?\s*(pi|tau)\b/gi, (m, num, word, offset) => {
      const expr = word.toLowerCase() === "pi" ? "Math.PI" : "(2*Math.PI)";
      if (num) return `${num}*${expr}`;
      const prev = offset > 0 ? raw[offset - 1] : "";
      if (/[\w.]/.test(prev)) return m; // part of a longer identifier — leave alone
      return expr;
    });
  return (
    <input
      ref={inputRef}
      value={txt}
      onBlur={() => setTxt(String(+value.toFixed(4)))}
      onChange={(e) => {
        setTxt(e.target.value);
        try {
          const v = new Function(`return (${toExpr(e.target.value)});`)();
          if (Number.isFinite(v)) onChange(v);
        } catch {
          /* partial input */
        }
      }}
      className="w-full rounded border border-[var(--panel-line)] bg-[var(--panel-input)] px-2 py-1 font-mono text-[11px] text-[var(--panel-text)] outline-none transition-colors hover:border-[var(--panel-dim)] focus:border-current"
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-200"
      style={{
        borderColor: checked
          ? "color-mix(in srgb, var(--acc) 60%, transparent)"
          : "var(--panel-off)",
        background: checked
          ? "color-mix(in srgb, var(--acc) 18%, transparent)"
          : "var(--panel-track)",
      }}
    >
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all duration-200"
        style={{
          left: checked ? "calc(100% - 13px)" : "3px",
          background: checked ? "var(--acc)" : "var(--panel-dim)",
          boxShadow: checked ? "0 0 8px var(--acc)" : "none",
        }}
      />
    </button>
  );
}
