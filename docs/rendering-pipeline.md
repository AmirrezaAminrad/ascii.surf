# The rendering pipeline

Every frame of ascii.surf travels the same road: state and input feed one
`requestAnimationFrame` loop, the loop hands a reused options object to a
shared engine, the engine samples the shape into a character-cell z-buffer,
post-processes it into glyphs, and the frontend paints those glyphs — on a
canvas in the browser, or as ANSI escapes in a terminal.

This is the diagram edition: four Mermaid flowcharts with short captions,
covering the whole pipeline end to end. A rendered one-page graphic of the
same story lives alongside it: [rendering-pipeline.svg](rendering-pipeline.svg).
The prose summary lives in the README's "How it works" section.

References use function names and repo-relative files; the two frontends are
`src/components/AsciiView.tsx` (web) and `cli/src/session.ts` (CLI), and the
engine they share is `src/engine/renderer.ts`.

## 1. The big picture

One shared engine (`src/engine/renderer.ts`), two frontends: the web frame loop
and the terminal CLI. Everything that can change the picture — the 63-shape
registry, debounced user code, settings and share state, pointer input, mesh
imports — feeds the same `requestAnimationFrame` loop, which talks to the
engine through a single reused `RenderOptions` object.

```mermaid
flowchart TB
  inputs["Inputs<br/>shape registry — src/engine/registry.ts<br/>live code surfaces — compileSurface() · 250 ms<br/>ViewSettings + share state — src/state.ts<br/>pointer · wheel · keys — plain refs<br/>STL / OBJ import — src/engine/mesh.ts"]

  subgraph web["Web frontend"]
    raf["requestAnimationFrame loop<br/>src/components/AsciiView.tsx<br/>fades · sizing · grid · idle skip"]
  end

  subgraph engine["Shared engine — src/engine/renderer.ts"]
    dispatch["renderFrame()<br/>dispatch by shape kind"]
    zbuf["projectPoints()<br/>character-cell z-buffer + shading"]
    post["persistence + charsFromLum()<br/>luminance → glyph rows"]
    dispatch --> zbuf --> post
  end

  subgraph out["Outputs"]
    canvas["Canvas 2D fillText<br/>mono rows / colored runs"]
    files["TXT · ANSI · HTML · SVG · PNG"]
    rec["GIF · WebM recorder"]
    canvas --> files
    canvas --> rec
  end

  subgraph cli["CLI"]
    session["RenderSession tick<br/>drift-corrected 30 fps timer"]
    ansi["frameToAnsi()<br/>run-length SGR truecolor"]
    session --> ansi
  end

  inputs --> raf
  raf -->|"RenderOptions (one reused object)"| dispatch
  post --> canvas
  post -.->|"the identical engine"| session
```

## 2. The web frame loop

`AsciiView.tsx` runs the only `requestAnimationFrame` loop. Each tick clamps
`dt`, flushes a coalesced zoom, advances the 400 ms crossfades, resizes the
canvas only when rounded device pixels changed, and derives the character grid
from cached font metrics. The idle check is what makes a still scene cost
nothing: a static frame with an unchanged `viewSig()` and nothing in motion
skips both render and draw while the loop keeps ticking.

```mermaid
flowchart TD
  raf["requestAnimationFrame — loop(now)"] --> dt["dt = min(0.1, elapsed)"]
  dt --> zoom["flush coalesced zoom<br/>one settings commit per frame"]
  zoom --> fades["advance crossfades — 400 ms<br/>charset dither · theme lerp · shape dissolve"]
  fades --> size["resize backing store<br/>only when round(W · dpr) changes"]
  size --> grid["cols = floor(W / cw), rows = floor(H / ch)<br/>cell metrics from the font cache"]
  grid --> time["advance time + rotation<br/>auto-spin · drag inertia, decay 0.05^dt"]
  time --> idle{"idle?"}
  idle -->|"static frame · viewSig unchanged ·<br/>no fades/drag/zoom/persistence/plasma"| skip["skip render + draw entirely<br/>the loop keeps ticking"]
  idle -->|busy| bg["fillRect background"]
  bg --> invoke["mutate the reused RenderOptions<br/>renderFrame(renderable, opt)"]
  invoke --> dissolve["shape dissolve:<br/>blend outgoing luminance, re-map glyphs"]
  dissolve --> draw["paint the canvas"]
  draw --> stats["EMA timings → external stats store<br/>every 250 ms"]
```

## 3. Geometry dispatch: five builders, one rasterizer

`renderFrame()` resets the shared buffers (`zbuf.fill(-Infinity)`,
`lum.fill(-1)`) and builds the per-frame `View` — the combined `Rz·Ry·Rx`
rotation matrix, projection gains, and normalized light. The renderable then
dispatches on its builder kind; everything converges on `projectPoints()`,
except planar shapes, which are screen-space and fill the per-cell field
directly. Time-invariant geometry is sampled once into `geoCache` and only
re-projected afterwards.

```mermaid
flowchart TB
  invoke["renderFrame(renderable, opt)"] --> reset["reset shared buffers<br/>build the per-frame View — Rz·Ry·Rx, gains, light"]
  reset --> kind{"builder kind"}

  kind -->|parametric| par["sampleParametric — fn(u, v, t)<br/>grid samples, tangent cross-product normals"]
  kind -->|generate| gen["shape.generate(params, time, pool)<br/>point cloud via framePush / frameGlow"]
  kind -->|implicit| imp["scanImplicit — F(x, y, z, t) on a corner grid<br/>one lit point per iso-crossing cell"]
  kind -->|sim| sim["cached live Sim instance<br/>sim.step(dt, time, pool, pointer)"]
  kind -->|planar| pla["screen-space pixel fn (u, v, t, env) per cell<br/>2×2 supersampling — env.prev reads the last frame"]

  par --> gcache{"static geometry<br/>already in geoCache?"}
  gen --> gcache
  imp --> gcache
  gcache -->|hit| proj
  gcache -->|"miss — sample once"| cached["store in geoCache"] --> proj
  sim --> proj
  pla --> field["planar field — per-cell luminance<br/>snapshotted into planarPrev for the next frame"]

  proj["projectPoints — rotate → project → splat → z-test<br/>shade: Lambert · Blinn-Phong · fog · emissive"]
  proj --> persist{"persistence > 0?"}
  field --> persist
  persist -->|yes| ping["ping-pong mix<br/>dst = max(lum, src · persistence)"]
  persist -->|no| chars
  ping --> chars["charsFromLum — luminance → glyph rows<br/>hash-dithered charset crossfade"]
  chars --> result["RenderResult { chars, lum, points, static }"]
```

## 4. Outputs: exports, recorder, and the CLI

The same `chars`/`lum` buffers feed every export — and, through the identical
engine, the terminal. The pure export builders in `src/engine/exports.ts`
consume the glyph rows directly; PNG is captured from the canvas; the recorder
(`src/app/useRecorder.ts`) taps the canvas stream for WebM and re-rasterizes at
15 fps, ≤ 420 px, through `gifenc` for GIF. The CLI (`cli/`) replays the
identical engine: `RenderSession` mirrors the web loop — same angles, inertia
and idle skip — on a drift-corrected 30 fps timer, and `frameToAnsi()`
translates the canvas drawing path to SGR truecolor escapes.

```mermaid
flowchart LR
  frame["RenderResult stored on<br/>frameRef / lumRef (App.tsx)"]
  screen["Canvas 2D<br/>mono: one fillText per row<br/>colored: run-length runs + glow"]
  frame --> screen
  screen --> png["PNG<br/>canvas.toBlob"]
  screen --> webm["WebM<br/>captureStream(60) + MediaRecorder"]
  screen --> gif["GIF<br/>offscreen canvas · 15 fps · gifenc"]
  frame --> builders["pure builders — exports.ts<br/>TXT · ANSI · HTML · SVG"]
  frame -.->|"the identical engine"| cli["CLI — cli/src<br/>RenderSession on a 30 fps timer<br/>same viewSig idle skip"]
  cli --> ansi["frameToAnsi()<br/>run-length SGR truecolor → stdout"]
  cli --> snap["--once snapshot mode<br/>txt / ansi / html / svg"]
```
