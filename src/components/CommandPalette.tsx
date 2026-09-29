import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Command palette (Ctrl+K): one fuzzy-searchable modal over shapes, themes,
 * charsets and actions. Keyboard-first — arrows move, Enter runs,
 * Esc closes — with a persisted shortlist of recent picks.
 */

export interface CommandItem {
  id: string;
  label: string;
  hint?: string; // secondary line (description / category)
  keys?: string; // shortcut hint, e.g. "X"
  section: string; // chip text: Shapes · Themes · Charsets · Actions
  keywords?: string; // extra search terms
  run: () => void;
}

const RECENTS_KEY = "ascii-surf-recents-v1";
const RECENTS_MAX = 6;
const LIST_CAP = 60;

function loadRecents(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX)
      : [];
  } catch {
    return [];
  }
}

function persistRecents(ids: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_MAX)));
  } catch {
    /* storage blocked */
  }
}

/**
 * Subsequence-aware match score (higher = better, -1 = no match): prefix hits
 * outrank word-boundary hits, which outrank substring and loose subsequence.
 */
function matchScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;
  const idx = t.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return t[idx - 1] === " " || t[idx - 1] === "-" ? 80 - idx : 60 - idx;
  let ti = 0;
  let streak = 0;
  let best = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    if (streak > best) best = streak;
    ti = found + 1;
  }
  return 20 + best * 2;
}

function itemScore(query: string, item: CommandItem): number {
  return Math.max(
    matchScore(query, item.label) + 10, // label matches win ties
    item.hint ? matchScore(query, item.hint) : -1,
    item.keywords ? matchScore(query, item.keywords) : -1,
  );
}

const SECTION_COLORS: Record<string, string> = {
  Shapes: "#7dd3fc",
  Themes: "#fcd34d",
  Charsets: "#86efac",
  Actions: "#fda4af",
  Color: "#a5b4fc",
};

export default function CommandPalette({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // fresh state each open: clear the query, refocus — a reopen is a new intent
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSel(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const ranked: CommandItem[] = useMemo(() => {
    if (!open) return [];
    const q = query.trim();
    if (q === "") {
      // empty query: recent picks first (only ones still registered), then everything
      const byId = new Map(items.map((i) => [i.id, i]));
      const recentItems = recents.map((id) => byId.get(id)).filter((i): i is CommandItem => !!i);
      const rest = items.filter((i) => !recents.includes(i.id));
      return [...recentItems, ...rest].slice(0, LIST_CAP);
    }
    return items
      .map((item) => ({ item, s: itemScore(q, item) }))
      .filter(({ s }) => s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, LIST_CAP)
      .map(({ item }) => item);
  }, [open, query, items, recents]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, ranked.length - 1)));
  }, [ranked.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const runItem = (item: CommandItem) => {
    const next = [item.id, ...recents.filter((r) => r !== item.id)].slice(0, RECENTS_MAX);
    setRecents(next);
    persistRecents(next);
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (ranked.length === 0 ? 0 : (s + 1) % ranked.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (ranked.length === 0 ? 0 : (s - 1 + ranked.length) % ranked.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = ranked[sel];
      if (item) runItem(item);
    }
  };

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="anim-pop w-full max-w-md overflow-hidden rounded-lg border border-white/15 bg-[#0b0b0e]/95 text-white shadow-[0_12px_48px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span aria-hidden="true" className="select-none text-[12px] text-white/35">
            ⌘
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="jump to a shape, theme, action…"
            aria-label="search commands"
            aria-activedescendant={ranked[sel] ? `cmd-${ranked[sel].id}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            className="w-full bg-transparent text-[13px] text-white/90 caret-white outline-none placeholder:text-white/30"
            spellCheck={false}
          />
          <span className="kbd shrink-0">esc</span>
        </div>
        <div
          ref={listRef}
          id="cmd-list"
          role="listbox"
          aria-label="commands"
          className="max-h-[46vh] overflow-y-auto p-1"
        >
          {ranked.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-white/35">
              nothing matches “{query.trim()}”
            </div>
          )}
          {ranked.map((item, i) => {
            const active = i === sel;
            const tagColor = SECTION_COLORS[item.section] ?? "#94a3b8";
            return (
              <div
                key={item.id}
                id={`cmd-${item.id}`}
                data-idx={i}
                role="option"
                aria-selected={active}
                onMouseMove={() => setSel(i)}
                onClick={() => runItem(item)}
                className={`flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[12px] transition-colors ${
                  active ? "bg-white/10" : ""
                }`}
                style={active ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)" } : undefined}
              >
                <span
                  aria-hidden="true"
                  className="w-[54px] shrink-0 truncate rounded border px-1 py-px text-center text-[8.5px] uppercase tracking-[0.12em]"
                  style={{
                    borderColor: tagColor + "55",
                    color: tagColor,
                    background: tagColor + "14",
                  }}
                >
                  {item.section}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${active ? "text-white" : "text-white/75"}`}
                >
                  {item.label}
                </span>
                {item.hint && (
                  <span className="hidden min-w-0 max-w-[45%] truncate text-[10px] text-white/35 sm:block">
                    {item.hint}
                  </span>
                )}
                {item.keys && <span className="kbd shrink-0">{item.keys}</span>}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-3 py-1.5 text-[9.5px] text-white/30">
          <span>
            <span className="kbd mr-1">↑</span>
            <span className="kbd mr-1">↓</span>navigate
          </span>
          <span>
            <span className="kbd mr-1">↵</span>run
          </span>
          <span className="ml-auto">
            {ranked.length} of {items.length}
          </span>
        </div>
      </div>
    </div>
  );
}
