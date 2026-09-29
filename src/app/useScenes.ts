import { useState } from "react";
import {
  DEFAULT_SETTINGS,
  loadScenes,
  persistScenes,
  sanitizeParamValues,
  type Scene,
  type StoredStateV2,
} from "../state";
import { THEMES, type Theme } from "../themes";
import { MESH_ID } from "../engine/mesh";
import { entryId as entryIdOf, findEntry } from "../engine/registry";
import { PRESETS } from "../engine/presets";
import type { Params, SurfaceDef } from "../engine/types";
import type { ViewSettings } from "../types";
import type { HistSnap } from "./useHistory";
import { downloadBlob } from "../utils";

/**
 * Scenes: named snapshots of the full app state (shape + code + view + theme),
 * persisted locally and importable/exportable as .json.
 */
export function useScenes({
  curRef,
  allThemesList,
  activeName,
  stopDemo,
  showFlash,
  pushSnap,
  atoms,
}: {
  curRef: React.MutableRefObject<{
    entryId: string;
    def: SurfaceDef;
    code: string;
    paramValues: Record<string, Params>;
    settings: ViewSettings;
  }>;
  allThemesList: Theme[];
  activeName: string;
  stopDemo: () => void;
  showFlash: (msg: string) => void;
  pushSnap: (snap: HistSnap, key: string, winMs?: number) => void;
  atoms: {
    setEntryId: (v: string) => void;
    setDef: (v: SurfaceDef) => void;
    setCode: (v: string) => void;
    setSettings: (v: ViewSettings) => void;
    setParamValues: (v: Record<string, Params>) => void;
  };
}) {
  const [scenes, setScenes] = useState<Scene[]>(loadScenes);
  const [sceneName, setSceneName] = useState("");

  const buildStoredState = (): StoredStateV2 => {
    const { settings: st, entryId: id, paramValues: pv, def: d, code: cd } = curRef.current;
    const state: StoredStateV2 = {
      v: 2,
      entryId: id,
      settings: { ...st, themeName: st.theme.name },
      paramValues: pv,
    };
    if (id === "custom" || id === MESH_ID || findEntry(id)?.tag === "code") {
      state.def = d;
      state.code = cd;
    }
    return state;
  };

  const saveScene = () => {
    const name = (sceneName.trim() || activeName).slice(0, 40);
    setScenes((list) => {
      const next = [
        { name, ts: Date.now(), state: buildStoredState() },
        ...list.filter((x) => x.name !== name),
      ].slice(0, 24);
      persistScenes(next);
      return next;
    });
    setSceneName("");
    showFlash(`scene "${name}" saved`);
  };

  const loadScene = (sc: Scene) => {
    const st = sc.state;
    if (!st || st.v !== 2 || !st.settings) {
      showFlash("unsupported scene version");
      return;
    }
    const theme = allThemesList.find((t) => t.name === st.settings.themeName) ?? THEMES[0];
    const nextSettings: ViewSettings = {
      ...DEFAULT_SETTINGS,
      ...st.settings,
      theme,
    } as ViewSettings;
    const nextParams = sanitizeParamValues(st.paramValues);
    let nextId: string;
    let nextDef = curRef.current.def;
    let nextCode = curRef.current.code;
    stopDemo();
    atoms.setSettings(nextSettings);
    atoms.setParamValues(nextParams);
    const entry = findEntry(st.entryId);
    if (entry && !(entry.tag === "native" && entry.shape.id === MESH_ID)) {
      nextId = entryIdOf(entry);
      atoms.setEntryId(nextId);
      if (entry.tag === "code") {
        nextDef = entry.def;
        nextCode = entry.def.code;
        atoms.setDef(entry.def);
        atoms.setCode(entry.def.code);
      }
    } else if (st.def && typeof st.def.code === "string") {
      nextId = "custom";
      nextDef = st.def;
      nextCode = st.code ?? st.def.code;
      atoms.setEntryId("custom");
      atoms.setDef(st.def);
      atoms.setCode(nextCode);
    } else {
      nextId = PRESETS[0].id;
      nextDef = PRESETS[0];
      nextCode = PRESETS[0].code;
      atoms.setEntryId(PRESETS[0].id);
      atoms.setDef(PRESETS[0]);
      atoms.setCode(PRESETS[0].code);
    }
    pushSnap(
      {
        entryId: nextId,
        def: nextDef,
        code: nextCode,
        paramValues: nextParams,
        settings: nextSettings,
      },
      "",
    );
    showFlash(`scene "${sc.name}" loaded`);
  };

  const deleteScene = (name: string) => {
    setScenes((list) => {
      const next = list.filter((x) => x.name !== name);
      persistScenes(next);
      return next;
    });
  };

  const exportScene = (sc: Scene) => {
    try {
      const blob = new Blob([JSON.stringify(sc.state, null, 1)], { type: "application/json" });
      downloadBlob(`ascii-surf-scene-${sc.name.replace(/[^\w-]+/g, "_")}.json`, blob);
      showFlash(`scene "${sc.name}" exported ✓ (${(blob.size / 1024).toFixed(1)} kB)`);
    } catch {
      showFlash("scene export failed");
    }
  };

  const importSceneFile = async (file: File) => {
    try {
      const st = JSON.parse(await file.text()) as StoredStateV2;
      if (!st || st.v !== 2) throw new Error("not a v2 state file");
      loadScene({
        name: file.name.replace(/\.json$/i, "").slice(0, 40),
        ts: Date.now(),
        state: st,
      });
    } catch (e) {
      showFlash(`scene import failed: ${(e as Error)?.message ?? "bad file"}`);
    }
  };

  return {
    scenes,
    sceneName,
    setSceneName,
    buildStoredState,
    saveScene,
    loadScene,
    deleteScene,
    exportScene,
    importSceneFile,
  };
}
