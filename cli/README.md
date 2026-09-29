# ascii-surf — the terminal CLI

The [ascii.surf](../README.md) engine in your terminal: the same 63 shapes,
z-buffer renderer, themes, charsets, and share-link states, driven by keys and
mouse instead of React. Two modes:

- **live** (default) — full-screen animated renderer: keyboard orbit, mouse
  hover/drag/wheel, the interactive pointer effects included.
- **`--once`** — render a single frame and exit; pipe-friendly, no TTY needed.

## Run it

```bash
npm run cli                       # from the repo root (tsx, no build step)
npm run build:cli                 # bundle once → cli/dist/cli.js
npx ascii-surf --help             # after `npm link` in cli/ (bin: ascii-surf)
```

Requires Node ≥ 20. Zero runtime dependencies — the bundle is one file.

## Examples

```bash
npm run cli -- --shape lorenz                      # any shape: id, name, or 1-based index
npm run cli -- --shape 1 --zoom 2 --ortho --fog 0.4
npm run cli -- --theme gameboy --charset blocks --color rainbow
npm run cli -- --shape lorenz --set speed=2 --set trail=8000
npm run cli -- --once --no-color                   # plain text → pipes, files, commits
npm run cli -- --shape 1 --once --format ansi --out torus.ans
npm run cli -- --shape 1 --once --format svg --out torus.svg
npm run cli -- --shape metaballs --warmup 120      # develop a simulation first
npm run cli -- --list shapes                       # index / id / name of all 63
npm run cli -- --list themes                       # or charsets
```

## Flags

Shape: `--shape <id|name|index>` · `--set <key=value>` (repeatable, clamped to
the shape's range) · `--state <base64url>` (a web share link's `#s=` payload)
· `--list [shapes|themes|charsets]`

View: `--cols` `--rows` (default: terminal size, or 100×40 piped) · `--zoom`
`--angle x,y,z` · `--spin x,y,z` / `--no-spin` · `--speed` · `--fov`
`--cam-dist` · `--ortho` · `--light x,y,z` · `--ambient` `--diffuse`
`--specular` `--shininess` · `--point-size` `--jitter` `--persistence` `--fog`
· `--samples` `--samples-v` · `--aspect` (cell height/width, default 2)

Style: `--theme <name>` · `--charset <name|glyphs>` · `--color
ramp|rainbow|plasma` · `--bg` / `--no-bg` · `--no-color`

Live: `--fps` (default 30) · `--mouse x,y` (fixed pointer for shaders) ·
`--pointer-auto` (sweep the pointer for you) · `--debug` (status line)

Snapshot: `--once` · `--time t` · `--warmup N` · `--format
txt|ansi|html|svg` (default: ansi on a terminal, txt piped) · `--out <file>`

Meta: `--help` · `--version`

## Keys (live)

| Key                | Action                           |
| ------------------ | -------------------------------- |
| `q` / `Esc`        | quit                             |
| `space`            | pause time                       |
| arrows / `h j k l` | orbit                            |
| `+` / `-`          | zoom                             |
| `1`–`9`            | load preset shape                |
| `n` / `p`          | next / previous shape (all 63)   |
| `t` / `c` / `m`    | theme / charset / color mode     |
| `o`                | perspective ⇄ ortho              |
| `r`                | reset view                       |
| `s`                | auto-spin                        |
| `f`                | fog                              |
| `x`                | randomize shape + theme + params |
| `d`                | debug status line                |

Mouse: hover moves the pointer uniform (the interactive effects follow it),
left-drag orbits with flick inertia, wheel zooms — the same gestures as the
web app.

## Sharing state with the web app

`--state` accepts the base64url string after `#s=` in a web share link and
restores the shape, code edits, parameters, theme, and view — `--shape` and
other flags override it:

```bash
npm run cli -- --state "eyJ2IjoyLC..." --shape trefoil --zoom 3
```

## Windows notes

Use **Windows Terminal** for live mode: raw keyboard input and SGR mouse
tracking both work there. Under mintty/Git Bash the process renders fine but
stdin isn't interactive (it renders without input; `Ctrl+C` exits). The
`--once` path works everywhere, including pipes and CI.
