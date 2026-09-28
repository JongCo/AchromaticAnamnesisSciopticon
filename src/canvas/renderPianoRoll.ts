import { JUDGEMENT_LINE_OFFSET, KEYBOARD_HEIGHT, PIANO_MAX_MIDI, PIANO_MIN_MIDI } from "../constants";
import type { EngineSnapshot } from "../engine/playbackEngine";
import type { AppSettings, ParsedMidi, ParsedNote, ViewRange } from "../types";
import { isInsideRange, midiToPitch, midiToPitchOctave } from "../utils/music";

type RenderOptions = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  midi: ParsedMidi | null;
  settings: AppSettings;
  viewRange: ViewRange;
  snapshot: EngineSnapshot;
  zoom: number;
  panMidi: number;
  isManualNote: (note: ParsedNote) => boolean;
};

export function renderPianoRoll(options: RenderOptions): void {
  const { ctx, width, height, midi, settings, snapshot, zoom, panMidi, viewRange, isManualNote } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#11151d";
  ctx.fillRect(0, 0, width, height);

  const noteAreaHeight = Math.max(120, height - KEYBOARD_HEIGHT);
  const judgementY = noteAreaHeight - JUDGEMENT_LINE_OFFSET;
  const visibleRange = expandedRange(viewRange, zoom, panMidi);
  const keyWidth = width / (visibleRange.maxMidi - visibleRange.minMidi + 1);

  drawGrid(ctx, width, noteAreaHeight, visibleRange, keyWidth, settings, snapshot);
  if (midi) drawNotes(ctx, midi.notes, noteAreaHeight, judgementY, visibleRange, keyWidth, settings, snapshot, isManualNote);
  drawJudgementLine(ctx, width, judgementY);
  drawKeyboard(ctx, width, height, noteAreaHeight, visibleRange, keyWidth, settings, snapshot);
}

function expandedRange(base: ViewRange, zoom: number, panMidi: number): ViewRange {
  const span = base.maxMidi - base.minMidi + 1;
  const visibleSpan = Math.max(12, Math.round(span / zoom));
  const center = (base.minMidi + base.maxMidi) / 2 + panMidi;
  let minMidi = Math.round(center - visibleSpan / 2);
  let maxMidi = minMidi + visibleSpan - 1;
  if (minMidi < PIANO_MIN_MIDI) {
    maxMidi += PIANO_MIN_MIDI - minMidi;
    minMidi = PIANO_MIN_MIDI;
  }
  if (maxMidi > PIANO_MAX_MIDI) {
    minMidi -= maxMidi - PIANO_MAX_MIDI;
    maxMidi = PIANO_MAX_MIDI;
  }
  return { minMidi: Math.max(PIANO_MIN_MIDI, minMidi), maxMidi: Math.min(PIANO_MAX_MIDI, maxMidi) };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  noteAreaHeight: number,
  range: ViewRange,
  keyWidth: number,
  settings: AppSettings,
  snapshot: EngineSnapshot,
): void {
  for (let midi = range.minMidi; midi <= range.maxMidi; midi += 1) {
    const x = (midi - range.minMidi) * keyWidth;
    const active = isInsideRange(midi, settings.userKeyRange);
    ctx.fillStyle = active ? (midi % 2 === 0 ? "#151c27" : "#121822") : "#0c0f15";
    ctx.fillRect(x, 0, Math.ceil(keyWidth), noteAreaHeight);
    if (active && snapshot.pressedNotes.has(midi)) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(x, 0, Math.ceil(keyWidth), noteAreaHeight);
    }
    if (isC(midi)) {
      ctx.fillStyle = "rgba(113, 190, 255, 0.35)";
      ctx.fillRect(x, 0, 2, noteAreaHeight);
    } else if (isFSharp(midi)) {
      ctx.fillStyle = "rgba(113, 190, 255, 0.16)";
      ctx.fillRect(x, 0, 1, noteAreaHeight);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = 0; y < noteAreaHeight; y += 72) {
    ctx.fillRect(0, y, width, 1);
  }
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: ParsedNote[],
  noteAreaHeight: number,
  judgementY: number,
  range: ViewRange,
  keyWidth: number,
  settings: AppSettings,
  snapshot: EngineSnapshot,
  isManualNote: (note: ParsedNote) => boolean,
): void {
  const travelSec = 6 / settings.scrollSpeed;
  const pxPerSec = judgementY / travelSec;
  const visibleStart = snapshot.timeSec - 1.5;
  const visibleEnd = snapshot.timeSec + travelSec + 1.5;

  for (const note of notes) {
    if (note.midi < range.minMidi || note.midi > range.maxMidi) continue;
    if (note.endSec < visibleStart || note.startSec > visibleEnd) continue;

    const x = (note.midi - range.minMidi) * keyWidth + 1;
    const yStart = judgementY - (note.startSec - snapshot.timeSec) * pxPerSec;
    const yEnd = judgementY - (note.endSec - snapshot.timeSec) * pxPerSec;
    const y = Math.min(yStart, yEnd);
    const h = Math.max(6, Math.abs(yEnd - yStart));
    const runtime = snapshot.noteRuntime.get(note.id);
    const manual = isManualNote(note);
    const activeRange = isInsideRange(note.midi, settings.userKeyRange);

    ctx.fillStyle = noteColor(note.midi, activeRange, runtime?.state ?? "pending", snapshot.pressedNotes.has(note.midi), settings);
    ctx.strokeStyle = manual ? "rgba(168, 224, 255, 0.45)" : "rgba(255, 211, 124, 0.25)";
    roundRect(ctx, x, y, Math.max(2, keyWidth - 2), h, 4);
    ctx.fill();
    ctx.stroke();
  }
}

function noteColor(midi: number, activeRange: boolean, state: string, pressed: boolean, settings: AppSettings): string {
  if (state === "missed" || state === "missed-but-held" || state === "failed-after-hit") return "#686f7c";
  if (!activeRange) return "#363b46";
  const baseColor = midi % 2 === 0 ? settings.noteColors.evenNote : settings.noteColors.oddNote;
  if (state === "held-correct" || state === "completed" || pressed) return feedbackColor(baseColor);
  return baseColor;
}

function drawJudgementLine(ctx: CanvasRenderingContext2D, width: number, y: number): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillRect(0, y, width, 2);
  ctx.fillStyle = "rgba(89, 227, 188, 0.16)";
  ctx.fillRect(0, y - 9, width, 20);
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  noteAreaHeight: number,
  range: ViewRange,
  keyWidth: number,
  settings: AppSettings,
  snapshot: EngineSnapshot,
): void {
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, noteAreaHeight, width, height - noteAreaHeight);

  for (let midi = range.minMidi; midi <= range.maxMidi; midi += 1) {
    const x = (midi - range.minMidi) * keyWidth;
    const active = isInsideRange(midi, settings.userKeyRange);
    const pressed = snapshot.pressedNotes.has(midi);
    const keyColor = midi % 2 === 0 ? settings.keyboardColors.lightKey : settings.keyboardColors.darkKey;

    ctx.fillStyle = pressed ? feedbackColor(keyColor) : active ? keyColor : "#404653";
    ctx.fillRect(x, noteAreaHeight + 1, Math.ceil(keyWidth), height - noteAreaHeight - 1);
    ctx.strokeStyle = keyDividerColor(midi);
    ctx.lineWidth = isC(midi) ? 2 : 1;
    ctx.strokeRect(x, noteAreaHeight + 1, keyWidth, height - noteAreaHeight - 1);

    if (settings.showNoteNames !== "none" && keyWidth > 16) {
      ctx.save();
      ctx.fillStyle = pressed ? "#05211b" : active ? contrastTextColor(keyColor) : "#11151d";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      const label = settings.showNoteNames === "pitch" ? midiToPitch(midi) : midiToPitchOctave(midi);
      ctx.fillText(label, x + keyWidth / 2, height - 18);
      ctx.restore();
    }
  }
}

function isC(midi: number): boolean {
  return midi % 12 === 0;
}

function isFSharp(midi: number): boolean {
  return midi % 12 === 6;
}

function keyDividerColor(midi: number): string {
  if (isC(midi)) return "#46b2ff";
  if (isFSharp(midi)) return "rgba(70, 178, 255, 0.42)";
  return "rgba(0, 0, 0, 0.38)";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function contrastTextColor(hex: string): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#12151a";
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.56 ? "#12151a" : "#f8fbff";
}

function feedbackColor(hex: string): string {
  const hsv = hexToHsv(hex);
  if (!hsv) return "#a9ddff";
  return hsvToHex({
    h: hsv.h,
    s: hsv.v >= 96 ? Math.max(0, hsv.s - 30) : Math.max(0, hsv.s - 8),
    v: Math.min(100, hsv.v + 24),
  });
}

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

function hexToHsv(hex: string): HsvColor | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    if (max === g) h = (b - r) / delta + 2;
    if (max === b) h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  };
}

function hsvToHex(hsv: HsvColor): string {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`;
}

function toHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
