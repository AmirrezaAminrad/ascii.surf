import { useEffect, useRef, useState } from "react";

/**
 * Boot splash: Matrix-style digital rain filling the viewport while the app
 * mounts, then fading out. Pure decoration — skipped entirely under reduced
 * motion (JS gate below + `.boot-rain { display: none }` in the CSS block).
 */

const GLYPHS = "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:・.=*+<>|";
const FONT = '15px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace';
const MIN_DWELL_MS = 1600; // rain plays at least this long
const FADE_MS = 700; // keep in sync with the .boot-rain transition

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function BootRain() {
  const [gone, setGone] = useState(reducedMotion);
  const [fading, setFading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reducedMotion()) {
      setGone(true);
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = 1; // render at 1× and let CSS upscale — soft CRT-like glyph edges
    const cellH = 15 * 1.05;
    let cw = 9;
    let cols: { y: number; speed: number }[] = [];
    let W = 0;
    let H = 0;

    let raf = 0;
    let last = performance.now();
    const step = (k: number) => {
      // translucent veil → old glyphs dim into green trails
      ctx.fillStyle = "rgba(0,0,0,0.09)";
      ctx.fillRect(0, 0, W, H);
      // phosphor bloom on every fresh glyph, like the reference's glow
      ctx.shadowColor = "#00ff41";
      ctx.shadowBlur = 6;
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        col.y += col.speed * k;
        const row = Math.floor(col.y);
        const x = c * cw;
        if (row >= 0 && row * cellH <= H) {
          const y = row * cellH;
          ctx.fillStyle = "#8fff8f"; // bright saturated-green head
          ctx.fillText(glyph(), x, y);
          // mutate a glyph further up the trail (Matrix shimmer)
          if (Math.random() < 0.03) {
            const r2 = row - 2 - ((Math.random() * 10) | 0);
            if (r2 >= 0 && r2 * cellH <= H) {
              ctx.globalAlpha = 0.6;
              ctx.fillStyle = "#00e64d";
              ctx.fillText(glyph(), x, r2 * cellH);
              ctx.globalAlpha = 1;
            }
          }
        }
        // recycle: past the bottom, or sporadically mid-screen for ragged gaps
        if (col.y * cellH > H + rand(0, 40) || Math.random() < 0.0012) {
          col.y = -rand(0, 12);
          col.speed = rand(0.25, 0.8);
        }
      }
      ctx.shadowBlur = 0;
    };

    const setup = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textBaseline = "top";
      cw = Math.max(6, ctx.measureText("M").width);
      cols = Array.from({ length: Math.ceil(W / cw) + 1 }, () => ({
        y: -rand(0, (H / cellH) * 0.9), // staggered starts → cascading bloom-in
        speed: rand(0.25, 0.8),
      }));
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      // pre-roll so the first visible frame already looks like mid-storm rain
      for (let i = 0; i < 45; i++) step(1);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const k = Math.min(now - last, 100) / 16.667; // frame-rate independent
      last = now;
      step(k);
    };

    setup();
    window.addEventListener("resize", setup);
    raf = requestAnimationFrame(frame);
    const t1 = window.setTimeout(() => setFading(true), MIN_DWELL_MS);
    const t2 = window.setTimeout(() => setGone(true), MIN_DWELL_MS + FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setup);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (gone) return null;
  return (
    <div
      className={`boot-rain pointer-events-none fixed inset-0 z-[70] bg-black ${fading ? "opacity-0" : ""}`}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="absolute inset-x-0 bottom-6 flex justify-center">
        <span className="text-[10px] uppercase tracking-[0.35em] text-[#00ff41] opacity-70">
          ascii.surf · booting
          <span
            aria-hidden="true"
            className="anim-blink ml-1.5 inline-block h-2.5 w-1.5 translate-y-0.5 bg-[#00ff41]"
          />
        </span>
      </div>
    </div>
  );
}
