import { useCallback, useRef, useState } from "react";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { downloadBlob } from "../utils";

/**
 * Canvas capture: WebM recording via captureStream + MediaRecorder, and
 * animated GIF export through gifenc (real-time capture at 15 fps, ≤420 px).
 * Owns the record-length setting (`recDur`) shown in the Time section.
 */
export function useRecorder({
  canvasRef,
  curRef,
  showFlash,
}: {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  curRef: React.MutableRefObject<{ entryId: string }>;
  showFlash: (msg: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recLeft, setRecLeft] = useState(0);
  const [recDur, setRecDur] = useState(5);
  const [gifLeft, setGifLeft] = useState(0);
  const [gifTotal, setGifTotal] = useState(0);
  const gifBusy = useRef(false);
  const gifCancel = useRef(false);
  const recRef = useRef<{
    mr: MediaRecorder;
    stream: MediaStream;
    stopTimer: number;
    tick: number;
  } | null>(null);
  const recDurRef = useRef(recDur);
  recDurRef.current = recDur;

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    window.clearTimeout(rec.stopTimer);
    window.clearInterval(rec.tick);
    setRecording(false);
    setRecLeft(0);
    try {
      if (rec.mr.state !== "inactive") rec.mr.stop();
    } catch {
      /* already stopped */
    }
    rec.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const startRecording = useCallback(() => {
    const c = canvasRef.current;
    if (!c || recRef.current) return;
    const mime =
      typeof MediaRecorder !== "undefined" && typeof c.captureStream === "function"
        ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
            MediaRecorder.isTypeSupported(m),
          )
        : null;
    if (!mime) {
      showFlash("recording is not supported in this browser");
      return;
    }
    try {
      const stream = c.captureStream(60);
      const chunks: Blob[] = [];
      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const name = `ascii-surf-${curRef.current.entryId}.webm`;
        downloadBlob(name, blob);
        showFlash(`saved ${name} (${(blob.size / 1024).toFixed(0)} kB)`);
      };
      mr.start(200);
      const dur = Math.max(1, Math.round(recDurRef.current));
      const tick = window.setInterval(() => setRecLeft((s) => Math.max(0, s - 1)), 1000);
      const stopTimer = window.setTimeout(stopRecording, dur * 1000);
      recRef.current = { mr, stream, stopTimer, tick };
      setRecording(true);
      setRecLeft(dur);
      showFlash(`recording ${dur}s…`);
    } catch {
      showFlash("recording failed to start");
    }
  }, [stopRecording, canvasRef, curRef, showFlash]);

  const toggleRecording = useCallback(() => {
    if (recRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  const startGif = useCallback(async () => {
    const c = canvasRef.current;
    if (!c || gifBusy.current) return;
    gifBusy.current = true;
    gifCancel.current = false;
    try {
      const fps = 15;
      const dur = Math.max(1, Math.round(recDurRef.current));
      const total = dur * fps;
      const k = Math.min(1, 420 / c.width);
      const w = Math.max(2, Math.round(c.width * k));
      const h = Math.max(2, Math.round(c.height * k));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) throw new Error("no 2d context");
      const enc = GIFEncoder();
      const delay = Math.round(1000 / fps);
      setGifTotal(total);
      setGifLeft(total);
      let cancelled = false;
      // wall-clock pacing: frame i is captured at t0 + i·delay, so capture/encode
      // work never accumulates into a slower-than-real-time GIF (late frames just
      // skip their wait and catch up)
      const t0 = performance.now();
      for (let i = 0; i < total; i++) {
        const wait = t0 + i * delay - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (gifCancel.current) {
          cancelled = true;
          break;
        }
        octx.drawImage(c, 0, 0, w, h);
        const { data } = octx.getImageData(0, 0, w, h);
        const palette = quantize(data, 256);
        enc.writeFrame(applyPalette(data, palette), w, h, { palette, delay });
        setGifLeft(total - 1 - i);
      }
      if (cancelled) {
        showFlash("gif capture cancelled");
      } else {
        enc.finish();
        const blob = new Blob([enc.bytes() as BlobPart], { type: "image/gif" });
        const name = `ascii-surf-${curRef.current.entryId}.gif`;
        downloadBlob(name, blob);
        showFlash(`saved ${name} (${(blob.size / 1024).toFixed(0)} kB)`);
      }
    } catch {
      showFlash("gif export failed");
    } finally {
      gifBusy.current = false;
      setGifTotal(0);
      setGifLeft(0);
    }
  }, [canvasRef, curRef, showFlash]);

  return {
    recording,
    recLeft,
    recDur,
    setRecDur,
    toggleRecording,
    startRecording,
    startGif,
    gifLeft,
    gifTotal,
    gifCancel,
  };
}
