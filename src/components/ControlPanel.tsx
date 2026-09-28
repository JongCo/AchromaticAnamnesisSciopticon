import {
  ArrowLeft,
  ChevronDown,
  Pause,
  Palette,
  Play,
  RotateCcw,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AB_REST_BEATS, PIANO_MAX_MIDI, PIANO_MIN_MIDI, PLAYBACK_SPEEDS, SOUND_PRESETS } from "../constants";
import type { AppSettings, MidiInputDevice, ParsedMidi, PracticeWaitGroup, ScoreState } from "../types";
import { formatSeconds, midiToPitchOctave } from "../utils/music";

type KeyboardColorTarget = keyof AppSettings["keyboardColors"];
type NoteColorTarget = keyof AppSettings["noteColors"];

const KEYBOARD_COLOR_LABELS: Record<KeyboardColorTarget, string> = {
  lightKey: "흰색 부분",
  darkKey: "어두운 부분",
};

const NOTE_COLOR_LABELS: Record<NoteColorTarget, string> = {
  evenNote: "짝수 노트",
  oddNote: "홀수 노트",
};

type ControlPanelProps = {
  midi: ParsedMidi | null;
  settings: AppSettings;
  isFreePlay: boolean;
  midiSupported: boolean;
  midiError: string | null;
  devices: MidiInputDevice[];
  currentTime: number;
  isPlaying: boolean;
  score: ScoreState;
  waitGroup: PracticeWaitGroup;
  zoom: number;
  panMidi: number;
  calibrationStep: "idle" | "low" | "high";
  onBackToSelection: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  onSoundPresetChange: (soundPreset: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  onSetAbPoint: (point: "A" | "B") => void;
  onZoomChange: (zoom: number) => void;
  onPanChange: (panMidi: number) => void;
  onStartCalibration: () => void;
};

export function ControlPanel(props: ControlPanelProps) {
  const [activeColorTarget, setActiveColorTarget] = useState<KeyboardColorTarget | null>(null);
  const [activeNoteColorTarget, setActiveNoteColorTarget] = useState<NoteColorTarget | null>(null);
  const {
    midi,
    settings,
    isFreePlay,
    midiSupported,
    midiError,
    devices,
    currentTime,
    isPlaying,
    score,
    waitGroup,
    zoom,
    panMidi,
    calibrationStep,
    onBackToSelection,
    onSettingsChange,
    onSoundPresetChange,
    onPlay,
    onPause,
    onStop,
    onSeek,
    onSetAbPoint,
    onZoomChange,
    onPanChange,
    onStartCalibration,
  } = props;

  const accuracy = score.hits + score.misses === 0 ? 100 : (score.hits / (score.hits + score.misses)) * 100;
  const updateKeyboardColor = (target: KeyboardColorTarget, color: string) => {
    onSettingsChange({
      ...settings,
      keyboardColors: {
        ...settings.keyboardColors,
        [target]: color,
      },
    });
  };
  const updateNoteColor = (target: NoteColorTarget, color: string) => {
    onSettingsChange({
      ...settings,
      noteColors: {
        ...settings.noteColors,
        [target]: color,
      },
    });
  };

  return (
    <aside className="control-panel">
      <section className="panel-section file-section">
        <button type="button" className="file-button" onClick={onBackToSelection}>
          <ArrowLeft size={16} />
          뒤로가기
        </button>
        <div className="file-meta">
          <strong>{isFreePlay ? "Free Play" : midi?.name ?? "No file"}</strong>
          <span>{midi ? `${midi.tracks.length} tracks, ${midi.notes.length} notes` : "MIDI 없이 연주 중"}</span>
        </div>
      </section>

      {!isFreePlay && (
        <section className="panel-section transport">
          <button type="button" onClick={isPlaying ? onPause : onPlay} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button type="button" onClick={onStop} title="Stop">
            <SkipBack size={17} />
          </button>
          <button type="button" onClick={() => onSeek(0)} title="Rewind">
            <RotateCcw size={17} />
          </button>
          <div className="time-readout">
            {formatSeconds(currentTime)} / {formatSeconds(midi?.durationSec ?? 0)}
          </div>
          <input
            className="seek"
            type="range"
            min={0}
            max={midi?.durationSec ?? 0}
            step={0.01}
            value={Math.max(0, Math.min(currentTime, midi?.durationSec ?? 0))}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
        </section>
      )}

      {!isFreePlay && (
        <section className="panel-section metrics">
          <div>
            <span>Hit</span>
            <strong>{score.hits}</strong>
          </div>
          <div>
            <span>Miss</span>
            <strong>{score.misses}</strong>
          </div>
          <div>
            <span>Accuracy</span>
            <strong>{accuracy.toFixed(1)}%</strong>
          </div>
          <div>
            <span>Early / Late</span>
            <strong>{score.early} / {score.late}</strong>
          </div>
        </section>
      )}

      {!isFreePlay && settings.mode === "practice" && (
        <section className="panel-section practice-status">
          <div className="section-title">Practice Wait</div>
          <p>Tick: {waitGroup.startTick ?? "-"}</p>
          <p>Pending: {waitGroup.pending.map(midiToPitchOctave).join(", ") || "-"}</p>
          <p>Done: {waitGroup.completed.map(midiToPitchOctave).join(", ") || "-"}</p>
        </section>
      )}

      <CollapsibleSection title="오디오" defaultOpen>
        <div className="grid-two">
          <label>
            Sound
            <select
              value={settings.soundPreset}
              onChange={(event) => onSoundPresetChange(event.currentTarget.value)}
            >
              {SOUND_PRESETS.map((preset) => (
                <option key={preset.soundFontId} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <RangeControl
            label="Master Volume"
            min={0}
            max={8}
            step={0.01}
            value={settings.masterVolume}
            suffix=""
            displayValue={`${Math.round(settings.masterVolume * 100)}%`}
            onChange={(masterVolume) => onSettingsChange({ ...settings, masterVolume })}
          />
          <div className="option-subsection reverb-controls">
            <div className="section-title">Reverb</div>
            <RangeControl
              label="Mix"
              min={0}
              max={1}
              step={0.01}
              value={settings.reverb.mix}
              suffix=""
              displayValue={`${Math.round(settings.reverb.mix * 100)}%`}
              onChange={(mix) => onSettingsChange({ ...settings, reverb: { ...settings.reverb, mix } })}
            />
            <RangeControl
              label="Decay"
              min={0.2}
              max={8}
              step={0.1}
              value={settings.reverb.decay}
              suffix="s"
              displayValue={`${settings.reverb.decay.toFixed(1)}s`}
              onChange={(decay) => onSettingsChange({ ...settings, reverb: { ...settings.reverb, decay } })}
            />
            <RangeControl
              label="Damp"
              min={500}
              max={18000}
              step={100}
              value={settings.reverb.damp}
              suffix="Hz"
              displayValue={`${settings.reverb.damp.toLocaleString()}Hz`}
              onChange={(damp) => onSettingsChange({ ...settings, reverb: { ...settings.reverb, damp } })}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="MIDI 입력">
        <label>
          MIDI 장치
          <select
            value={settings.selectedMidiInputId ?? ""}
            onChange={(event) => {
              const device = devices.find((item) => item.id === event.currentTarget.value);
              onSettingsChange({
                ...settings,
                selectedMidiInputId: device?.id ?? null,
                selectedMidiInputName: device?.name ?? null,
              });
            }}
          >
            <option value="">선택 안 함</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        {!midiSupported && <p className="warning">Web MIDI API를 사용할 수 없는 브라우저입니다. Chrome 또는 Edge를 사용해 주세요.</p>}
        {midiError && <p className="warning">{midiError}</p>}
        <div className="device-list">{devices.map((device) => <span key={device.id}>{device.name}</span>)}</div>
        <div className="option-subsection">
          <div className="section-title">건반 범위</div>
          <div className="grid-two">
            <label>
              Key Min
              <input
                type="number"
                min={PIANO_MIN_MIDI}
                max={settings.userKeyRange.maxMidi}
                value={settings.userKeyRange.minMidi}
                onChange={(event) => onSettingsChange({ ...settings, userKeyRange: { ...settings.userKeyRange, minMidi: Number(event.currentTarget.value) } })}
              />
            </label>
            <label>
              Key Max
              <input
                type="number"
                min={settings.userKeyRange.minMidi}
                max={PIANO_MAX_MIDI}
                value={settings.userKeyRange.maxMidi}
                onChange={(event) => onSettingsChange({ ...settings, userKeyRange: { ...settings.userKeyRange, maxMidi: Number(event.currentTarget.value) } })}
              />
            </label>
            <button type="button" className="wide-button" onClick={onStartCalibration}>
              {calibrationStep === "idle" ? "MIDI Calibration" : calibrationStep === "low" ? "가장 낮은 키를 누르세요" : "가장 높은 키를 누르세요"}
            </button>
            <div className="range-readout">
              {midiToPitchOctave(settings.userKeyRange.minMidi)} - {midiToPitchOctave(settings.userKeyRange.maxMidi)}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {!isFreePlay && (
        <CollapsibleSection title="트랙">
          <div className="track-list">
            {midi?.tracks.map((track) => (
              <label key={track.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.selectedTrackIds.includes(track.id)}
                  onChange={(event) => {
                    const selectedTrackIds = event.currentTarget.checked
                      ? [...settings.selectedTrackIds, track.id]
                      : settings.selectedTrackIds.filter((id) => id !== track.id);
                    onSettingsChange({ ...settings, selectedTrackIds });
                  }}
                />
                <span>{track.name}</span>
                <small>{track.noteCount}</small>
              </label>
            )) ?? <span className="muted">트랙 없음</span>}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="재생 및 화면">
        <div className="grid-two">
          {!isFreePlay && (
            <label>
              Playback
              <select
                value={settings.playbackSpeed}
                onChange={(event) => onSettingsChange({ ...settings, playbackSpeed: Number(event.currentTarget.value) })}
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isFreePlay && <RangeControl label="Scroll" min={0.5} max={5} step={0.1} value={settings.scrollSpeed} suffix="x" onChange={(scrollSpeed) => onSettingsChange({ ...settings, scrollSpeed })} />}
          <label>
            Note Names
            <select
              value={settings.showNoteNames}
              onChange={(event) => onSettingsChange({ ...settings, showNoteNames: event.currentTarget.value as AppSettings["showNoteNames"] })}
            >
              <option value="none">표시 안 함</option>
              <option value="pitch">C, C#</option>
              <option value="pitch-octave">C4, C#4</option>
            </select>
          </label>
          <button type="button" title="Zoom out" onClick={() => onZoomChange(Math.max(1, zoom - 0.25))}>
            <ZoomOut size={16} /> {zoom.toFixed(2)}x
          </button>
          <button type="button" title="Zoom in" onClick={() => onZoomChange(Math.min(6, zoom + 0.25))}>
            <ZoomIn size={16} />
          </button>
          <RangeControl label="Pan" min={-48} max={48} step={1} value={panMidi} suffix="" onChange={onPanChange} />
          <div className="keyboard-colors">
            <div className="section-title">건반 색상</div>
            <div className="color-button-row">
              {(["lightKey", "darkKey"] as KeyboardColorTarget[]).map((target) => (
                <button
                  key={target}
                  type="button"
                  className={activeColorTarget === target ? "color-button active" : "color-button"}
                  onClick={() => setActiveColorTarget(activeColorTarget === target ? null : target)}
                >
                  <Palette size={15} />
                  <span className="color-swatch" style={{ backgroundColor: settings.keyboardColors[target] }} />
                  {KEYBOARD_COLOR_LABELS[target]}
                </button>
              ))}
            </div>
            {activeColorTarget && (
              <HsvColorPicker
                label={KEYBOARD_COLOR_LABELS[activeColorTarget]}
                value={settings.keyboardColors[activeColorTarget]}
                onChange={(color) => updateKeyboardColor(activeColorTarget, color)}
              />
            )}
          </div>
          <div className="keyboard-colors">
            <div className="section-title">노트 색상</div>
            <div className="color-button-row">
              {(["evenNote", "oddNote"] as NoteColorTarget[]).map((target) => (
                <button
                  key={target}
                  type="button"
                  className={activeNoteColorTarget === target ? "color-button active" : "color-button"}
                  onClick={() => setActiveNoteColorTarget(activeNoteColorTarget === target ? null : target)}
                >
                  <Palette size={15} />
                  <span className="color-swatch" style={{ backgroundColor: settings.noteColors[target] }} />
                  {NOTE_COLOR_LABELS[target]}
                </button>
              ))}
            </div>
            {activeNoteColorTarget && (
              <HsvColorPicker
                label={NOTE_COLOR_LABELS[activeNoteColorTarget]}
                value={settings.noteColors[activeNoteColorTarget]}
                onChange={(color) => updateNoteColor(activeNoteColorTarget, color)}
              />
            )}
          </div>
        </div>
      </CollapsibleSection>

      {!isFreePlay && (
        <CollapsibleSection title="판정">
          <div className="grid-two">
            <RangeControl label="Input Offset" min={-250} max={250} step={1} value={settings.inputOffsetMs} suffix="ms" onChange={(inputOffsetMs) => onSettingsChange({ ...settings, inputOffsetMs })} />
            <RangeControl label="Judge Offset" min={-250} max={250} step={1} value={settings.judgementOffsetMs} suffix="ms" onChange={(judgementOffsetMs) => onSettingsChange({ ...settings, judgementOffsetMs })} />
            <RangeControl label="Window" min={20} max={250} step={1} value={settings.judgementWindowMs} suffix="ms" onChange={(judgementWindowMs) => onSettingsChange({ ...settings, judgementWindowMs })} />
          </div>
        </CollapsibleSection>
      )}

      {!isFreePlay && (
        <CollapsibleSection title="AB 반복">
          <div className="grid-two">
            <button type="button" onClick={() => onSetAbPoint("A")}>Set A</button>
            <button type="button" onClick={() => onSetAbPoint("B")}>Set B</button>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.abLoop.enabled}
                onChange={(event) => onSettingsChange({ ...settings, abLoop: { ...settings.abLoop, enabled: event.currentTarget.checked } })}
              />
              AB Loop
            </label>
            <label>
              Rest Beats
              <select
                value={settings.abLoop.restBeats}
                onChange={(event) => onSettingsChange({ ...settings, abLoop: { ...settings.abLoop, restBeats: Number(event.currentTarget.value) } })}
              >
                {AB_REST_BEATS.map((beat) => <option key={beat}>{beat}</option>)}
              </select>
            </label>
            <div className="ab-readout">
              A {settings.abLoop.startSec === null ? "-" : formatSeconds(settings.abLoop.startSec)}
            </div>
            <div className="ab-readout">
              B {settings.abLoop.endSec === null ? "-" : formatSeconds(settings.abLoop.endSec)}
            </div>
          </div>
        </CollapsibleSection>
      )}
    </aside>
  );
}

type CollapsibleSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="panel-section collapsible-section">
      <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        <summary>
          <span>{title}</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <div className="collapsible-content">{children}</div>
      </details>
    </section>
  );
}

type RangeControlProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix: string;
  displayValue?: string;
  onChange: (value: number) => void;
};

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

type HsvColorPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function HsvColorPicker({ label, value, onChange }: HsvColorPickerProps) {
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(value));
  const lastLocalHexRef = useRef(value);
  const lastLabelRef = useRef(label);

  useEffect(() => {
    const labelChanged = lastLabelRef.current !== label;
    lastLabelRef.current = label;
    if (!labelChanged && value === lastLocalHexRef.current) return;
    lastLocalHexRef.current = value;
    setHsv(hexToHsv(value));
  }, [label, value]);

  const setChannel = (channel: keyof HsvColor, nextValue: number) => {
    const nextHsv = { ...hsv, [channel]: nextValue };
    const nextHex = hsvToHex(nextHsv);
    setHsv(nextHsv);
    lastLocalHexRef.current = nextHex;
    onChange(nextHex);
  };

  return (
    <div className="hsv-picker">
      <div className="color-preview">
        <span>{label}</span>
        <strong>{value.toUpperCase()}</strong>
      </div>
      <label className="hsv-control">
        <span>
          H
          <strong>{Math.round(hsv.h)}°</strong>
        </span>
        <input type="range" min={0} max={360} step={1} value={hsv.h} onChange={(event) => setChannel("h", Number(event.currentTarget.value))} />
      </label>
      <label className="hsv-control">
        <span>
          S
          <strong>{Math.round(hsv.s)}%</strong>
        </span>
        <input type="range" min={0} max={100} step={1} value={hsv.s} onChange={(event) => setChannel("s", Number(event.currentTarget.value))} />
      </label>
      <label className="hsv-control">
        <span>
          V
          <strong>{Math.round(hsv.v)}%</strong>
        </span>
        <input type="range" min={0} max={100} step={1} value={hsv.v} onChange={(event) => setChannel("v", Number(event.currentTarget.value))} />
      </label>
    </div>
  );
}

function RangeControl({ label, min, max, step, value, suffix, displayValue, onChange }: RangeControlProps) {
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>{displayValue ?? `${value}${suffix}`}</strong>
      </span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  );
}

function hexToHsv(hex: string): HsvColor {
  const rgb = hexToRgb(hex) ?? hexToRgb("#e8edf4");
  if (!rgb) return { h: 0, s: 0, v: 100 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
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
    h: Math.round(h),
    s: Math.round(max === 0 ? 0 : (delta / max) * 100),
    v: Math.round(max * 100),
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
