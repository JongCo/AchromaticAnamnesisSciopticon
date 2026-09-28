import { MIN_HOLD_RATIO, MIN_HOLD_SEC, PIANO_MAX_MIDI, PIANO_MIN_MIDI, START_LEAD_IN_SEC } from "../constants";
import type {
  AppSettings,
  JudgeState,
  MidiNoteMessage,
  ParsedMidi,
  ParsedNote,
  PracticeWaitGroup,
  ScoreState,
} from "../types";
import { AudioEngine } from "../services/audioEngine";
import { beatLengthAtTime, clamp, isInsideRange } from "../utils/music";

type NoteRuntime = {
  state: JudgeState;
  missCounted: boolean;
  hitAtSec: number | null;
  held: boolean;
  autoStarted: boolean;
  autoStopped: boolean;
};

export type EngineSnapshot = {
  timeSec: number;
  isPlaying: boolean;
  score: ScoreState;
  pressedNotes: Set<number>;
  waitGroup: PracticeWaitGroup;
  noteRuntime: Map<string, NoteRuntime>;
};

export class PlaybackEngine {
  private midi: ParsedMidi | null = null;
  private settings: AppSettings;
  private audio: AudioEngine;
  private noteRuntime = new Map<string, NoteRuntime>();
  private pressedNotes = new Set<number>();
  private userVoiceStacks = new Map<number, string[]>();
  private score: ScoreState = { hits: 0, misses: 0, early: 0, late: 0 };
  private playing = false;
  private timeSec = 0;
  private lastFrameMs: number | null = null;
  private restUntilMs: number | null = null;
  private waitGroup: PracticeWaitGroup = { startTick: null, pending: [], completed: [] };
  private completedPracticeStartTicks = new Set<number>();

  constructor(settings: AppSettings, audio: AudioEngine) {
    this.settings = settings;
    this.audio = audio;
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.audio.setPreset(settings.soundPreset);
    this.audio.setMasterVolume(settings.masterVolume);
    this.audio.setReverb(settings.reverb);
  }

  setMidi(midi: ParsedMidi | null): void {
    this.midi = midi;
    this.seek(0);
    this.resetJudgement();
  }

  getSnapshot(): EngineSnapshot {
    return {
      timeSec: this.timeSec,
      isPlaying: this.playing,
      score: { ...this.score },
      pressedNotes: new Set(this.pressedNotes),
      waitGroup: {
        startTick: this.waitGroup.startTick,
        pending: [...this.waitGroup.pending],
        completed: [...this.waitGroup.completed],
      },
      noteRuntime: new Map(this.noteRuntime),
    };
  }

  isManualNote(note: ParsedNote): boolean {
    return this.settings.selectedTrackIds.includes(note.trackId) && isInsideRange(note.midi, this.settings.userKeyRange);
  }

  play(): void {
    if (this.timeSec === 0) {
      this.timeSec = -START_LEAD_IN_SEC;
    }
    this.playing = true;
    this.lastFrameMs = null;
  }

  pause(): void {
    this.playing = false;
    this.lastFrameMs = null;
    this.audio.stopAll();
  }

  stop(): void {
    this.playing = false;
    this.seek(0);
    this.resetJudgement();
    this.audio.stopAll();
  }

  seek(seconds: number): void {
    this.timeSec = clamp(seconds, 0, this.midi?.durationSec ?? 0);
    this.lastFrameMs = null;
    this.restUntilMs = null;
    this.waitGroup = { startTick: null, pending: [], completed: [] };
    this.resetJudgement();
    this.audio.stopAll();
  }

  tick(frameMs: number): void {
    if (!this.midi || !this.playing) {
      this.lastFrameMs = frameMs;
      return;
    }
    if (this.restUntilMs && frameMs < this.restUntilMs) {
      this.lastFrameMs = frameMs;
      return;
    }
    if (this.restUntilMs && frameMs >= this.restUntilMs) {
      this.restUntilMs = null;
    }

    const delta = this.lastFrameMs === null ? 0 : ((frameMs - this.lastFrameMs) / 1000) * this.settings.playbackSpeed;
    this.lastFrameMs = frameMs;
    const nextTime = clamp(this.timeSec + delta, -START_LEAD_IN_SEC, this.midi.durationSec);

    if (this.settings.mode === "practice") {
      this.advancePractice(nextTime);
    } else {
      this.timeSec = nextTime;
      this.updateGameJudgement();
    }

    this.updateAutoPlayback();
    this.handleAbLoop(frameMs);
  }

  async handleMidiMessage(message: MidiNoteMessage): Promise<void> {
    const correctedTime = this.timeSec + this.settings.inputOffsetMs / 1000;
    await this.audio.ensureStarted();
    if (message.type === "noteon") {
      this.pressedNotes.add(message.midi);
      const voiceId = `input-${message.midi}-${message.receivedAtMs}-${Math.random().toString(16).slice(2)}`;
      const stack = this.userVoiceStacks.get(message.midi) ?? [];
      stack.push(voiceId);
      this.userVoiceStacks.set(message.midi, stack);
      this.audio.noteOn(voiceId, message.midi, message.velocity);
      if (this.settings.mode === "practice") {
        this.handlePracticeNoteOn(message.midi, correctedTime);
      } else {
        this.handleGameNoteOn(message.midi, correctedTime);
      }
    } else {
      this.pressedNotes.delete(message.midi);
      const stack = this.userVoiceStacks.get(message.midi) ?? [];
      const voiceId = stack.shift();
      if (voiceId) this.audio.noteOff(voiceId);
      this.userVoiceStacks.set(message.midi, stack);
      if (this.settings.mode === "practice") {
        this.updatePracticeWaitGroupProgress();
      } else {
        this.handleGameNoteOff(message.midi, correctedTime);
      }
    }
  }

  private resetJudgement(): void {
    this.noteRuntime.clear();
    this.completedPracticeStartTicks.clear();
    this.score = { hits: 0, misses: 0, early: 0, late: 0 };
    if (!this.midi) return;
    for (const note of this.midi.notes) {
      this.noteRuntime.set(note.id, {
        state: "pending",
        missCounted: false,
        hitAtSec: null,
        held: false,
        autoStarted: false,
        autoStopped: false,
      });
    }
  }

  private runtime(note: ParsedNote): NoteRuntime {
    let runtime = this.noteRuntime.get(note.id);
    if (!runtime) {
      runtime = {
        state: "pending",
        missCounted: false,
        hitAtSec: null,
        held: false,
        autoStarted: false,
        autoStopped: false,
      };
      this.noteRuntime.set(note.id, runtime);
    }
    return runtime;
  }

  private handleGameNoteOn(midi: number, correctedInputTime: number): void {
    if (!this.midi) return;
    const windowSec = this.settings.judgementWindowMs / 1000;
    const offsetSec = this.settings.judgementOffsetMs / 1000;
    const candidates = this.midi.notes.filter((note) => {
      if (!this.isManualNote(note) || note.midi !== midi) return false;
      const runtime = this.runtime(note);
      if (runtime.state !== "pending") return false;
      const judgeStart = note.startSec + offsetSec;
      return correctedInputTime >= judgeStart - windowSec && correctedInputTime <= judgeStart + windowSec;
    });

    candidates.sort((a, b) => Math.abs(a.startSec - correctedInputTime) - Math.abs(b.startSec - correctedInputTime));
    const note = candidates[0];
    if (note) {
      const runtime = this.runtime(note);
      runtime.state = "held-correct";
      runtime.hitAtSec = correctedInputTime;
      runtime.held = true;
      this.score.hits += 1;
      if (correctedInputTime < note.startSec + offsetSec) this.score.early += 1;
      if (correctedInputTime > note.startSec + offsetSec) this.score.late += 1;
      return;
    }

    for (const missed of this.midi.notes) {
      if (!this.isManualNote(missed) || missed.midi !== midi) continue;
      const runtime = this.runtime(missed);
      if (runtime.state === "missed" && correctedInputTime <= missed.endSec) {
        runtime.state = "missed-but-held";
        runtime.held = true;
        break;
      }
    }
  }

  private handleGameNoteOff(midi: number, correctedInputTime: number): void {
    if (!this.midi) return;
    for (const note of this.midi.notes) {
      if (!this.isManualNote(note) || note.midi !== midi) continue;
      const runtime = this.runtime(note);
      if (runtime.state === "held-correct" && runtime.held) {
        runtime.held = false;
        const heldFor = Math.max(0, correctedInputTime - (runtime.hitAtSec ?? note.startSec));
        const required = Math.min(note.durationSec * MIN_HOLD_RATIO, Math.max(MIN_HOLD_SEC, note.durationSec * 0.25));
        if (note.durationSec > MIN_HOLD_SEC && heldFor < required) {
          runtime.state = "failed-after-hit";
          this.countMiss(runtime);
        } else {
          runtime.state = "completed";
        }
      } else if (runtime.state === "missed-but-held") {
        runtime.held = false;
        runtime.state = "missed";
      }
    }
  }

  private updateGameJudgement(): void {
    if (!this.midi) return;
    const windowSec = this.settings.judgementWindowMs / 1000;
    const offsetSec = this.settings.judgementOffsetMs / 1000;

    for (const note of this.midi.notes) {
      if (!this.isManualNote(note)) continue;
      const runtime = this.runtime(note);
      const judgeStart = note.startSec + offsetSec;
      if (runtime.state === "pending" && this.timeSec > judgeStart + windowSec) {
        runtime.state = this.pressedNotes.has(note.midi) && this.timeSec <= note.endSec ? "missed-but-held" : "missed";
        this.countMiss(runtime);
      }
      if (runtime.state === "held-correct" && this.timeSec >= note.endSec) {
        runtime.state = "completed";
        runtime.held = false;
      }
      if (runtime.state === "missed-but-held" && !this.pressedNotes.has(note.midi)) {
        runtime.state = "missed";
        runtime.held = false;
      }
    }
  }

  private advancePractice(nextTime: number): void {
    if (!this.midi) return;
    if (this.waitGroup.startTick !== null && this.waitGroup.pending.length > 0) return;

    const nextManualStart = this.midi.notes.find((note) => {
      return (
        this.isManualNote(note) &&
        !this.completedPracticeStartTicks.has(note.startTick) &&
        note.startSec > this.timeSec &&
        note.startSec <= nextTime + 0.0001
      );
    });

    if (!nextManualStart) {
      this.timeSec = nextTime;
      return;
    }

    this.timeSec = nextManualStart.startSec;
    this.waitGroup = {
      startTick: nextManualStart.startTick,
      pending: this.getPracticeGroup(nextManualStart.startTick),
      completed: [],
    };
  }

  private handlePracticeNoteOn(midi: number, correctedInputTime: number): void {
    if (this.waitGroup.startTick === null && !this.openEarlyPracticeGroup(midi, correctedInputTime)) return;
    if (!this.getCurrentPracticeGroup().includes(midi)) return;
    this.updatePracticeWaitGroupProgress();
  }

  private updatePracticeWaitGroupProgress(): void {
    if (this.waitGroup.startTick === null) return;
    const group = this.getCurrentPracticeGroup();
    this.waitGroup.pending = group.filter((groupMidi) => !this.pressedNotes.has(groupMidi));
    this.waitGroup.completed = group.filter((groupMidi) => this.pressedNotes.has(groupMidi));
    if (this.waitGroup.pending.length === 0) {
      this.completedPracticeStartTicks.add(this.waitGroup.startTick);
      this.waitGroup = { startTick: null, pending: [], completed: [] };
    }
  }

  private getCurrentPracticeGroup(): number[] {
    return this.uniquePracticeGroup([...this.waitGroup.completed, ...this.waitGroup.pending]);
  }

  private openEarlyPracticeGroup(midi: number, correctedInputTime: number): boolean {
    if (!this.midi) return false;
    const windowSec = this.settings.judgementWindowMs / 1000;
    const offsetSec = this.settings.judgementOffsetMs / 1000;
    const candidates = this.midi.notes.filter((note) => {
      if (!this.isManualNote(note) || note.midi !== midi) return false;
      if (this.completedPracticeStartTicks.has(note.startTick)) return false;
      const judgeStart = note.startSec + offsetSec;
      return correctedInputTime >= judgeStart - windowSec && correctedInputTime <= judgeStart + windowSec;
    });

    candidates.sort((a, b) => Math.abs(a.startSec - correctedInputTime) - Math.abs(b.startSec - correctedInputTime));
    const note = candidates[0];
    if (!note) return false;

    this.timeSec = note.startSec;
    this.waitGroup = {
      startTick: note.startTick,
      pending: this.getPracticeGroup(note.startTick),
      completed: [],
    };
    return true;
  }

  private getPracticeGroup(startTick: number): number[] {
    if (!this.midi) return [];
    return this.uniquePracticeGroup(
      this.midi.notes
        .filter((note) => this.isManualNote(note) && note.startTick === startTick)
        .map((note) => note.midi),
    );
  }

  private uniquePracticeGroup(group: number[]): number[] {
    return group.filter((midi, index) => group.indexOf(midi) === index);
  }

  private updateAutoPlayback(): void {
    if (!this.midi) return;
    for (const note of this.midi.notes) {
      const runtime = this.runtime(note);
      const shouldAuto = !this.isManualNote(note);
      if (!shouldAuto) continue;
      if (!runtime.autoStarted && note.startSec <= this.timeSec && note.endSec >= this.timeSec) {
        runtime.autoStarted = true;
        this.audio.noteOn(`auto-${note.id}`, note.midi, note.velocity);
      }
      if (runtime.autoStarted && !runtime.autoStopped && note.endSec <= this.timeSec) {
        runtime.autoStopped = true;
        this.audio.noteOff(`auto-${note.id}`);
      }
    }
  }

  private handleAbLoop(frameMs: number): void {
    if (!this.midi || !this.settings.abLoop.enabled) return;
    const { startSec, endSec, restBeats } = this.settings.abLoop;
    if (startSec === null || endSec === null || endSec <= startSec) return;
    if (this.timeSec < endSec) return;
    const beatLength = beatLengthAtTime(this.midi.tempos, startSec);
    this.seek(startSec);
    this.playing = true;
    this.restUntilMs = frameMs + (beatLength * restBeats * 1000) / this.settings.playbackSpeed;
  }

  private countMiss(runtime: NoteRuntime): void {
    if (runtime.missCounted) return;
    runtime.missCounted = true;
    this.score.misses += 1;
  }

  getDisplayMinMax(): { min: number; max: number } {
    return { min: PIANO_MIN_MIDI, max: PIANO_MAX_MIDI };
  }
}
