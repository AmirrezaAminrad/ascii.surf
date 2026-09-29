/**
 * Entry point: argument dispatch (help/version/list), scene construction and
 * the live/snapshot mode decision. main() returns an exit code so tests can
 * exercise the whole dispatch without spawning a process.
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import cliPkg from "../package.json";
import { parseArgs, usageText } from "./args";
import { buildScene, listCharsets, listShapes, listThemes, SceneError, type Scene } from "./scene";
import { runLive } from "./live";
import { renderSnapshot, type OutputFormat } from "./snapshot";

const VERSION = cliPkg.version;

const LISTS: Record<string, () => string> = {
  shapes: listShapes,
  themes: listThemes,
  charsets: listCharsets,
};

export async function main(argv: string[]): Promise<number> {
  const { opts, error } = parseArgs(argv);
  if (error !== null || opts === null) {
    process.stderr.write(`ascii-surf: ${error}\n`);
    return 2;
  }

  if (opts.help) {
    process.stdout.write(usageText + "\n");
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`ascii-surf ${VERSION}\n`);
    return 0;
  }
  if (opts.list !== null) {
    const fn = LISTS[opts.list];
    if (!fn) {
      process.stderr.write(
        `ascii-surf: unknown --list "${opts.list}" (shapes, themes, charsets)\n`,
      );
      return 2;
    }
    process.stdout.write(fn() + "\n");
    return 0;
  }

  let scene: Scene;
  try {
    scene = buildScene(opts);
  } catch (e) {
    const msg =
      e instanceof SceneError
        ? e.message
        : `failed to build the scene: ${(e as Error)?.message ?? String(e)}`;
    process.stderr.write(`ascii-surf: ${msg}\n`);
    return 2;
  }

  const tty = process.stdout.isTTY === true;
  if (opts.once || !tty) {
    if (!tty && !opts.once) {
      process.stderr.write(
        "note: stdout is not a terminal — rendering a single frame (run inside a terminal for live mode)\n",
      );
    }
    // explicit --cols/--rows must not bypass the guards the defaults have
    const clampGrid = (n: number) => Math.max(1, Math.min(1000, Math.round(n)));
    const cols =
      opts.cols !== null
        ? clampGrid(opts.cols)
        : tty
          ? Math.max(20, process.stdout.columns || 80)
          : 100;
    const rows =
      opts.rows !== null
        ? clampGrid(opts.rows)
        : tty
          ? Math.max(8, (process.stdout.rows || 24) - 1)
          : 40;
    const format: OutputFormat = opts.format ?? (opts.noColor || opts.out || !tty ? "txt" : "ansi");
    const text = renderSnapshot(scene, opts, cols, rows, format);
    if (opts.out) {
      await writeFile(opts.out, text + "\n");
      process.stderr.write(`wrote ${opts.out} (${cols}x${rows} ${format})\n`);
    } else {
      process.stdout.write(text + "\n");
    }
    return 0;
  }

  await runLive(scene, opts);
  return 0;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      // runtime failures (e.g. an unwritable --out) get a clean message and
      // exit code 2, not an unhandled-rejection stack trace
      process.stderr.write(`ascii-surf: ${(e as Error)?.message ?? String(e)}\n`);
      process.exitCode = 2;
    },
  );
}
