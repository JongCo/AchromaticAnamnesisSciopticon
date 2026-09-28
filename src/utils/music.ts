import { PIANO_MAX_MIDI, PIANO_MIN_MIDI } from "../constants";
import type { TempoEvent, UserKeyRange, ViewRange } from "../types";

const PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isInsideRange(midi: number, range: UserKeyRange): boolean {
  return midi >= range.minMidi && midi <= range.maxMidi;
}

export function midiToPitch(midi: number): string {
  return PITCHES[((midi % 12) + 12) % 12];
}

export function midiToPitchOctave(midi: number): string {
  return `${midiToPitch(midi)}${Math.floor(midi / 12) - 1}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const negative = seconds < 0;
  const safe = Math.abs(seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${negative ? "-" : ""}${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function autoViewRange(activeRange: UserKeyRange): ViewRange {
  const minMidi = clamp(activeRange.minMidi - 3, PIANO_MIN_MIDI, PIANO_MAX_MIDI);
  const maxMidi = clamp(activeRange.maxMidi + 3, PIANO_MIN_MIDI, PIANO_MAX_MIDI);
  return { minMidi, maxMidi };
}

export function beatLengthAtTime(tempos: TempoEvent[], timeSec: number): number {
  if (!tempos.length) return 0.5;
  let bpm = tempos[0].bpm;
  for (const tempo of tempos) {
    if (tempo.time <= timeSec) bpm = tempo.bpm;
    else break;
  }
  return 60 / bpm;
}
