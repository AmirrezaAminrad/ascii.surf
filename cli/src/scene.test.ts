import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, encodeState } from "../../src/state";
import { CHARSETS } from "../../src/engine/presets";
import { SHAPES, entryId, entryName } from "../../src/engine/registry";
import {
  buildScene,
  listCharsets,
  listShapes,
  listThemes,
  lookupTheme,
  mergedParams,
  resolveShape,
} from "./scene";
import { parseArgs } from "./args";

const optsOf = (argv: string) => {
  const { opts, error } = parseArgs(argv.split(" ").filter(Boolean));
  if (error !== null) throw new Error(error);
  return opts;
};

describe("resolveShape", () => {
  it("resolves by 1-based index, exact id, and unique name substring", () => {
    expect(entryId(resolveShape("1"))).toBe(entryId(SHAPES[0]));
    expect(entryId(resolveShape(String(SHAPES.length)))).toBe(entryId(SHAPES[SHAPES.length - 1]));
    expect(entryId(resolveShape(entryName(SHAPES[0]).toLowerCase()))).toBe(entryId(SHAPES[0]));
  });

  it("rejects out-of-range, missing, and ambiguous tokens", () => {
    expect(() => resolveShape("0")).toThrow(/out of range/);
    expect(() => resolveShape(String(SHAPES.length + 1))).toThrow(/out of range/);
    expect(() => resolveShape("no-such-shape-xyz")).toThrow(/no shape matching/);
    expect(() => resolveShape("a")).toThrow(/ambiguous/); // matches many names
  });
});

describe("lookupTheme", () => {
  it("matches exactly and uniquely", () => {
    expect(lookupTheme("phosphor").name).toBe("Phosphor");
    expect(lookupTheme("ga").name).toBe("Gameboy"); // unique prefix
    expect(() => lookupTheme("nope")).toThrow(/no theme/);
  });
});

describe("mergedParams", () => {
  const specs = [
    { key: "a", label: "A", min: 0, max: 10, step: 1, def: 5 },
    { key: "b", label: "B", min: 1, max: 3, step: 1, def: 2, int: true },
  ];

  it("layers defaults < stored < overrides with clamping", () => {
    const p = mergedParams(specs, { a: 8 }, [
      ["a", 3],
      ["b", 99],
    ]);
    expect(p.a).toBe(3);
    expect(p.b).toBe(3); // clamped to max, stays int
    expect(mergedParams(specs, undefined, []).a).toBe(5);
  });

  it("rejects unknown parameter keys", () => {
    expect(() => mergedParams(specs, undefined, [["zzz", 1]])).toThrow(/unknown parameter/);
  });
});

describe("buildScene", () => {
  it("defaults to the first registry shape with default settings", () => {
    const scene = buildScene(optsOf(""));
    expect(scene.entryId).toBe(entryId(SHAPES[0]));
    expect(scene.renderable.tag).toBe("code");
    if (scene.renderable.tag === "code") expect(scene.renderable.fn).not.toBeNull();
    expect(scene.settings.charset).toBe(CHARSETS[0].chars);
    expect(scene.settings.theme.name).toBe("Phosphor");
    expect(scene.settings.autoRotate).toBe(true);
  });

  it("applies view and style flags", () => {
    const scene = buildScene(
      optsOf(
        "--shape lorenz --zoom 2 --ortho --theme amber --charset blocks --color rainbow --no-spin --fog 0.5",
      ),
    );
    expect(scene.renderable.tag).toBe("native");
    expect(scene.settings.zoom).toBe(2);
    expect(scene.settings.projection).toBe("ortho");
    expect(scene.settings.theme.name).toBe("Amber");
    expect(scene.settings.charset).toBe(CHARSETS[2].chars);
    expect(scene.settings.colorMode).toBe("rainbow");
    expect(scene.settings.autoRotate).toBe(false);
    expect(scene.settings.fog).toBe(0.5);
  });

  it("clamps --set values into the parameter range", () => {
    const lorenz = resolveShape("lorenz");
    if (lorenz.tag !== "native") throw new Error("expected native");
    const spec = lorenz.shape.params[0]; // sigma: 5..20
    const scene = buildScene(optsOf(`--shape lorenz --set ${spec.key}=99999`));
    if (scene.renderable.tag !== "native") throw new Error("expected native");
    expect(scene.renderable.params[spec.key]).toBe(spec.max);
  });

  it("rejects --set on code shapes and unknown params on native ones", () => {
    expect(() => buildScene(optsOf("--set foo=1"))).toThrow(/--set applies to native/);
    expect(() => buildScene(optsOf("--shape lorenz --set nope=1"))).toThrow(/unknown parameter/);
  });

  it("restores a web share-link state and lets --shape override it", () => {
    const { theme: _theme, ...base } = DEFAULT_SETTINGS;
    const encoded = encodeState({
      v: 2,
      entryId: "lorenz",
      paramValues: { lorenz: {} },
      settings: { ...base, themeName: "Gameboy", zoom: 2.5, spin: [0, 0, 0] },
    });
    const scene = buildScene(optsOf(`--state ${encoded}`));
    expect(scene.entryId).toBe("lorenz");
    expect(scene.settings.theme.name).toBe("Gameboy");
    expect(scene.settings.zoom).toBe(2.5);
    expect(scene.settings.charset).toBe(CHARSETS[0].chars); // unset fields fall back

    const overridden = buildScene(optsOf(`--state ${encoded} --shape 1 --zoom 3`));
    expect(overridden.entryId).toBe(entryId(SHAPES[0]));
    expect(overridden.settings.zoom).toBe(3);
    expect(overridden.renderable.tag).toBe("code");
  });

  it("rejects an undecodable state string", () => {
    expect(() => buildScene(optsOf("--state @@garbage@@"))).toThrow(/could not decode/);
  });
});

describe("list output", () => {
  it("enumerates every shape and honors row formatting", () => {
    const lines = listShapes().split("\n");
    expect(lines.length).toBe(SHAPES.length + 1);
    expect(lines[1]).toMatch(/^\s*1 /);
    expect(listThemes()).toMatch(/Phosphor/);
    expect(listCharsets()).toContain(CHARSETS[0].chars);
  });
});
