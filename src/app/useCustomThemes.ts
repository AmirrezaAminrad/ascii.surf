import { useMemo, useState } from "react";
import {
  CUSTOM_THEMES_MAX,
  THEMES,
  loadCustomThemes,
  persistCustomThemes,
  type Theme,
  type ThemeDraft,
} from "../themes";
import type { ViewSettings } from "../types";

/**
 * User-built custom themes: CRUD over the persisted list plus the draft state
 * for the Theme-section editor. `allThemesList` is built-ins first, custom
 * after — the same order the picker and randomizer use.
 */
export function useCustomThemes({
  curRef,
  patch,
  showFlash,
}: {
  curRef: React.MutableRefObject<{ settings: ViewSettings }>;
  patch: (p: Partial<ViewSettings>) => void;
  showFlash: (msg: string) => void;
}) {
  const [customThemes, setCustomThemes] = useState<Theme[]>(loadCustomThemes);
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(null);

  const allThemesList = useMemo(() => [...THEMES, ...customThemes], [customThemes]);

  /** Persist a validated draft as a custom theme and make it active. */
  const saveTheme = () => {
    if (!themeDraft) return;
    const name = themeDraft.name.trim().slice(0, 24) || "Custom theme";
    if (allThemesList.some((t) => t.name === name)) {
      showFlash(`theme "${name}" already exists`);
      return;
    }
    const theme: Theme = {
      name,
      bg: themeDraft.bg,
      fg: themeDraft.fg,
      glow: themeDraft.glow,
      mode: themeDraft.mode,
    };
    const next = [...customThemes, theme].slice(-CUSTOM_THEMES_MAX);
    setCustomThemes(next);
    persistCustomThemes(next);
    patch({ theme });
    setThemeDraft(null);
    showFlash(`theme "${name}" saved ✓`);
  };

  const deleteTheme = (name: string) => {
    const next = customThemes.filter((t) => t.name !== name);
    setCustomThemes(next);
    persistCustomThemes(next);
    if (curRef.current.settings.theme.name === name) {
      patch({ theme: THEMES[0] });
      showFlash(`theme "${name}" deleted — back to ${THEMES[0].name}`);
    } else {
      showFlash(`theme "${name}" deleted`);
    }
  };

  return { customThemes, themeDraft, setThemeDraft, allThemesList, saveTheme, deleteTheme };
}
