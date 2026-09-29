import type { ViewSettings } from "../types";
import { fpsColor, useStats } from "./statsStore";

const normDeg = (rad: number) => ((((rad * 180) / Math.PI) % 360) + 360) % 360;

/** Surface-time readout for panel headers — subscribes to the stats store directly. */
export function TimeReadout() {
  const { stats } = useStats();
  return <>{stats.time.toFixed(1)}s</>;
}

interface Props {
  settings: ViewSettings;
  accent: string;
  demo: boolean;
  demoIdx: number;
  demoCount: number;
  recording: boolean;
  recLeft: number;
  animated: boolean;
  isCode: boolean;
  gifLeft: number;
  gifTotal: number;
}

/** Tiny sparkline of the last ~60 fps samples (inline SVG, no extra canvas). */
function Spark({ hist, color }: { hist: number[]; color: string }) {
  const w = 78;
  const h = 16;
  const max = Math.max(60, ...hist);
  const pts = hist
    .map(
      (f, i) =>
        `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - (f / max) * (h - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden="true" className="opacity-80">
      <defs>
        <linearGradient id="fps-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {hist.length > 1 && <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#fps-grad)" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" opacity="0.7" />
      {hist.length > 0 && (
        <circle cx={w} cy={h - (hist[hist.length - 1] / max) * (h - 2) - 1} r="1.6" fill={color} />
      )}
    </svg>
  );
}

/** Thin vertical rule between status-bar groups. */
function Sep() {
  return (
    <span aria-hidden="true" className="hidden select-none opacity-20 sm:inline">
      │
    </span>
  );
}

export default function StatusBar(p: Props) {
  const { stats, hist: fpsHist } = useStats();
  const color = fpsColor(stats.fps);
  const { settings } = p;
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[11px] tabular-nums">
      <span className="inline-flex items-center gap-1.5" style={{ color }}>
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${stats.fps < 30 ? "anim-blink" : "fps-breathe"}`}
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
        {stats.fps.toFixed(0)} fps
      </span>
      {fpsHist.length > 3 && <Spark hist={fpsHist} color={color} />}
      <span className="opacity-55">{stats.ms.toFixed(1)} ms</span>
      <Sep />
      {p.demo && (
        <span className="inline-flex items-center gap-1" style={{ color: p.accent }}>
          demo {p.demoIdx + 1}/{p.demoCount}
        </span>
      )}
      <span className="opacity-55">
        {stats.cols}×{stats.rows} cells
      </span>
      <span className="opacity-55">{stats.points.toLocaleString()} px</span>
      {!p.isCode && (
        <span className="hidden opacity-55 sm:inline">
          {settings.samplesV > 0
            ? `${settings.samples}×${settings.samplesV} grid`
            : `${settings.samples}² grid`}
        </span>
      )}
      <Sep />
      {p.recording && (
        <span className="anim-blink" style={{ color: "#f87171" }}>
          ● rec {p.recLeft}s
        </span>
      )}
      {p.gifTotal > 0 && p.gifLeft > 0 && (
        <span className="anim-blink" style={{ color: p.accent }}>
          ◈ gif {p.gifTotal - p.gifLeft}/{p.gifTotal}
        </span>
      )}
      {p.animated && (
        <span className="inline-flex items-center gap-1" style={{ color: p.accent }}>
          {settings.paused ? "⏸ t frozen" : `t ${stats.time.toFixed(1)}s`}
        </span>
      )}
      <span className="opacity-55">{settings.zoom.toFixed(2)}× zoom</span>
      <span className="hidden opacity-55 md:inline">
        θ {normDeg(stats.angles[0]).toFixed(0)}° / {normDeg(stats.angles[1]).toFixed(0)}° /{" "}
        {normDeg(stats.angles[2]).toFixed(0)}°
      </span>
      {settings.debug && (
        <span className="opacity-70">
          engine {stats.engineMs.toFixed(1)} · draw {stats.drawMs.toFixed(1)} ms ·{" "}
          {settings.projection} · fov {settings.fov.toFixed(1)} · dist {settings.camDist.toFixed(1)}
          {settings.pointSize > 1 ? ` · px ${settings.pointSize}×` : ""}
          {settings.jitter > 0 ? ` · jitter ${Math.round(settings.jitter * 100)}%` : ""}
        </span>
      )}
      <span className="ml-auto hidden opacity-40 sm:inline">
        drag rotate · scroll zoom · ? shortcuts
      </span>
    </div>
  );
}
