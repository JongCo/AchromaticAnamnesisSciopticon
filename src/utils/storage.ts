import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, SOUND_PRESETS } from "../constants";
import type { AppSettings } from "../types";

const LEGACY_SOUND_PRESETS: Record<string, string> = {
  Piano: "Acoustic Grand Piano",
  "Electric Piano": "Electric Piano 1",
  Organ: "Drawbar Organ",
  Synth: "Lead 2 (sawtooth)",
  Bell: "Tubular Bells",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const soundPreset = normalizeSoundPreset(parsed.soundPreset);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      soundPreset,
      userKeyRange: {
        ...DEFAULT_SETTINGS.userKeyRange,
        ...parsed.userKeyRange,
      },
      keyboardColors: {
        ...DEFAULT_SETTINGS.keyboardColors,
        ...parsed.keyboardColors,
      },
      noteColors: {
        ...DEFAULT_SETTINGS.noteColors,
        ...parsed.noteColors,
      },
      reverb: {
        ...DEFAULT_SETTINGS.reverb,
        ...parsed.reverb,
      },
      abLoop: {
        ...DEFAULT_SETTINGS.abLoop,
        ...parsed.abLoop,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  const serializable: AppSettings = {
    ...settings,
    selectedTrackIds: settings.selectedTrackIds,
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(serializable));
}

function normalizeSoundPreset(soundPreset: string | undefined): string {
  if (!soundPreset) return DEFAULT_SETTINGS.soundPreset;
  const mapped = LEGACY_SOUND_PRESETS[soundPreset] ?? soundPreset;
  return SOUND_PRESETS.some((preset) => preset.name === mapped) ? mapped : DEFAULT_SETTINGS.soundPreset;
}
