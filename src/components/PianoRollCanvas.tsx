import { useEffect, useMemo, useRef, useState } from "react";
import { renderPianoRoll } from "../canvas/renderPianoRoll";
import type { PlaybackEngine } from "../engine/playbackEngine";
import type { AppSettings, ParsedMidi } from "../types";
import { autoViewRange } from "../utils/music";

type PianoRollCanvasProps = {
  midi: ParsedMidi | null;
  settings: AppSettings;
  engine: PlaybackEngine;
  zoom: number;
  panMidi: number;
  onSnapshot: () => void;
};

export function PianoRollCanvas({ midi, settings, engine, zoom, panMidi, onSnapshot }: PianoRollCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sizeVersion, setSizeVersion] = useState(0);
  const baseRange = useMemo(() => autoViewRange(settings.userKeyRange), [settings.userKeyRange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      setSizeVersion((value) => value + 1);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let animationId = 0;

    const frame = (now: number) => {
      engine.tick(now);
      const ratio = window.devicePixelRatio || 1;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const rect = canvas.getBoundingClientRect();
      renderPianoRoll({
        ctx,
        width: rect.width,
        height: rect.height,
        midi,
        settings,
        viewRange: baseRange,
        snapshot: engine.getSnapshot(),
        zoom,
        panMidi,
        isManualNote: (note) => engine.isManualNote(note),
      });
      onSnapshot();
      animationId = requestAnimationFrame(frame);
    };

    animationId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationId);
  }, [baseRange, engine, midi, onSnapshot, panMidi, settings, sizeVersion, zoom]);

  return <canvas ref={canvasRef} className="piano-roll" />;
}
