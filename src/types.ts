export type NoteNameMode = "none" | "pitch" | "pitch-octave";
export type PracticeMode = "game" | "practice";
export type JudgeState =
  | "pending"
  | "held-correct"
  | "missed"
  | "missed-but-held"
  | "completed"
  | "failed-after-hit";

export type ParsedNote = {
  id: string;
  trackId: string;
  trackName: string;
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
  startSec: number;
  endSec: number;
  durationSec: number;
};

export type TrackInfo = {
  id: string;
  name: string;
  noteCount: number;
};

export type TempoEvent = {
  ticks: number;
  bpm: number;
  time: number;
};

export type ParsedMidi = {
  name: string;
  tracks: TrackInfo[];
  notes: ParsedNote[];
  durationSec: number;
  ppq: number;
  tempos: TempoEvent[];
};

export type MidiLibraryFolder = {
  id: string;
  name: string;
  createdAt: number;
};

export type MidiLibraryFile = {
  id: string;
  folderId: string;
  name: string;
  displayName: string | null;
  size: number;
  type: string;
  difficulty: number;
  createdAt: number;
  updatedAt: number;
};

export type MidiLibraryState = {
  folders: MidiLibraryFolder[];
  files: MidiLibraryFile[];
};

export type UserKeyRange = {
  minMidi: number;
  maxMidi: number;
};

export type AbLoopSettings = {
  enabled: boolean;
  startSec: number | null;
  endSec: number | null;
  restBeats: number;
};

export type KeyboardColors = {
  lightKey: string;
  darkKey: string;
};

export type NoteColors = {
  evenNote: string;
  oddNote: string;
};

export type ReverbSettings = {
  mix: number;
  decay: number;
  damp: number;
};

export type AppSettings = {
  selectedTrackIds: string[];
  userKeyRange: UserKeyRange;
  playbackSpeed: number;
  scrollSpeed: number;
  inputOffsetMs: number;
  judgementOffsetMs: number;
  judgementWindowMs: number;
  showNoteNames: NoteNameMode;
  soundPreset: string;
  masterVolume: number;
  reverb: ReverbSettings;
  keyboardColors: KeyboardColors;
  noteColors: NoteColors;
  abLoop: AbLoopSettings;
  mode: PracticeMode;
  selectedMidiInputId: string | null;
  selectedMidiInputName: string | null;
};

export type MidiInputDevice = {
  id: string;
  name: string;
  manufacturer?: string;
};

export type MidiNoteMessage = {
  midi: number;
  velocity: number;
  type: "noteon" | "noteoff";
  receivedAtMs: number;
};

export type ScoreState = {
  hits: number;
  misses: number;
  early: number;
  late: number;
};

export type PracticeWaitGroup = {
  startTick: number | null;
  pending: number[];
  completed: number[];
};

export type ViewRange = {
  minMidi: number;
  maxMidi: number;
};
