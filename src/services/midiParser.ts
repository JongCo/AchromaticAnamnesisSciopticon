import { Midi } from "@tonejs/midi";
import type { ParsedMidi, ParsedNote, TempoEvent, TrackInfo } from "../types";

export async function parseMidiFile(file: File): Promise<ParsedMidi> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  const tracks: TrackInfo[] = [];
  const notes: ParsedNote[] = [];

  midi.tracks.forEach((track, index) => {
    const trackId = `track-${index}`;
    const name = track.name?.trim() || `Track ${index + 1}`;
    tracks.push({ id: trackId, name, noteCount: track.notes.length });

    track.notes.forEach((note, noteIndex) => {
      notes.push({
        id: `${trackId}-note-${noteIndex}`,
        trackId,
        trackName: name,
        midi: note.midi,
        velocity: note.velocity,
        startTick: note.ticks,
        endTick: note.ticks + note.durationTicks,
        startSec: note.time,
        endSec: note.time + note.duration,
        durationSec: note.duration,
      });
    });
  });

  notes.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);

  const tempos: TempoEvent[] =
    midi.header.tempos.length > 0
      ? midi.header.tempos.map((tempo) => ({
          ticks: tempo.ticks,
          bpm: tempo.bpm,
          time: midi.header.ticksToSeconds(tempo.ticks),
        }))
      : [{ ticks: 0, bpm: 120, time: 0 }];

  return {
    name: file.name,
    tracks,
    notes,
    durationSec: midi.duration,
    ppq: midi.header.ppq,
    tempos,
  };
}
