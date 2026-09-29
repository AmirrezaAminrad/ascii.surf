import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import cliPkg from "../package.json";
import { usageText } from "./args";
import { main } from "./main";

/** Runs main() with stdout/stderr captured so dispatch tests need no process. */
async function captureMain(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const outs: string[] = [];
  const errs: string[] = [];
  const so = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    outs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const se = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    errs.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  try {
    const code = await main(argv);
    return { code, out: outs.join(""), err: errs.join("") };
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
}

describe("main dispatch", () => {
  it("prints the version from cli/package.json", async () => {
    const { code, out } = await captureMain(["--version"]);
    expect(code).toBe(0);
    expect(out).toBe(`ascii-surf ${cliPkg.version}\n`);
  });

  it("prints usage on --help", async () => {
    const { code, out } = await captureMain(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain(usageText);
  });

  it("lists shapes on --list shapes", async () => {
    const { code, out } = await captureMain(["--list", "shapes"]);
    expect(code).toBe(0);
    expect(out).toContain("lorenz");
  });

  it("rejects unknown flags with exit code 2", async () => {
    const { code, err } = await captureMain(["--nope"]);
    expect(code).toBe(2);
    expect(err).toMatch(/^ascii-surf: unknown flag/);
  });

  it("rejects unknown --list targets with exit code 2", async () => {
    const { code, err } = await captureMain(["--list", "nope"]);
    expect(code).toBe(2);
    expect(err).toContain("unknown --list");
  });

  it("reports scene errors on stderr with exit code 2", async () => {
    const { code, err } = await captureMain(["--shape", "no-such-shape", "--once"]);
    expect(code).toBe(2);
    expect(err).toMatch(/^ascii-surf: /);
  });

  it("renders a single frame to stdout", async () => {
    const { code, out } = await captureMain([
      "--shape",
      "1",
      "--once",
      "--cols",
      "20",
      "--rows",
      "6",
      "--no-color",
    ]);
    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it("writes snapshots to --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ascii-surf-main-test-"));
    const file = join(dir, "frame.txt");
    try {
      const { code } = await captureMain([
        "--shape",
        "1",
        "--once",
        "--cols",
        "12",
        "--rows",
        "4",
        "--out",
        file,
      ]);
      expect(code).toBe(0);
      expect(await readFile(file, "utf8")).toMatch(/\S/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
