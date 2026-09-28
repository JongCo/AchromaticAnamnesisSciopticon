import { WorkletSynthesizer } from "spessasynth_lib";
import { SOUND_PRESETS } from "../constants";
import type { ReverbSettings } from "../types";

type ActiveVoice = {
  midi: number;
  timeoutId?: number;
};

const SYNTH_CHANNEL = 0;
const SOUNDFONT_ID = "musescore-general";
const SOUNDFONT_PATH = "soundfonts/MuseScore_General.sf3";
const WORKLET_PATH = "spessasynth_processor.min.js";

export class AudioEngine {
  private context: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private initialization: Promise<void> | null = null;
  private voices = new Map<string, ActiveVoice>();
  private preset = "Acoustic Grand Piano";
  private volume = 0.82;
  private reverb: ReverbSettings = { mix: 0.2, decay: 2.4, damp: 6000 };
  private reverbInput: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dampingFilter: BiquadFilterNode | null = null;
  private impulseUpdateTimer: number | null = null;

  setPreset(preset: string): void {
    this.preset = preset;
    this.applyPreset();
  }

  setMasterVolume(volume: number): void {
    this.volume = Math.min(8, Math.max(0, volume));
    this.synth?.setSystemParameter("gain", this.volume);
  }

  setReverb(settings: ReverbSettings): void {
    const nextReverb = {
      mix: clamp(settings.mix, 0, 1),
      decay: clamp(settings.decay, 0.2, 8),
      damp: clamp(settings.damp, 500, 18000),
    };
    const decayChanged = nextReverb.decay !== this.reverb.decay;
    this.reverb = nextReverb;
    this.applyReverbControls();
    if (decayChanged) this.scheduleImpulseUpdate();
  }

  isReady(): boolean {
    return this.synth !== null;
  }

  prepare(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async ensureStarted(): Promise<void> {
    await this.prepare();
    if (this.context?.state !== "running") {
      await this.context?.resume();
    }
  }

  noteOn(id: string, midi: number, velocity = 0.8): void {
    if (!this.synth || this.voices.has(id)) return;
    const normalizedVelocity = Math.round(Math.min(1, Math.max(0, velocity)) * 127);
    if (normalizedVelocity === 0) return;

    this.voices.set(id, { midi });
    this.synth.noteOn(SYNTH_CHANNEL, midi, normalizedVelocity);
  }

  noteOff(id: string): void {
    const voice = this.voices.get(id);
    if (!voice || !this.synth) return;
    if (voice.timeoutId) window.clearTimeout(voice.timeoutId);
    this.synth.noteOff(SYNTH_CHANNEL, voice.midi);
    this.voices.delete(id);
  }

  trigger(id: string, midi: number, velocity: number, durationSec: number): void {
    this.noteOn(id, midi, velocity);
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.timeoutId = window.setTimeout(() => this.noteOff(id), Math.max(60, durationSec * 1000));
  }

  stopAll(): void {
    for (const voice of this.voices.values()) {
      if (voice.timeoutId) window.clearTimeout(voice.timeoutId);
    }
    this.voices.clear();
    this.synth?.stopAll(true);
  }

  private async initialize(): Promise<void> {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    this.context = context;

    try {
      await context.audioWorklet.addModule(assetUrl(WORKLET_PATH));
      const synth = new WorkletSynthesizer(context);
      this.createReverbGraph(context);
      synth.connect(this.reverbInput!);
      await synth.isReady;

      const soundFont = await loadBundledSoundFont();
      await synth.soundBankManager.addSoundBank(soundFont, SOUNDFONT_ID);
      this.synth = synth;
      this.applyPreset();
      synth.setSystemParameter("gain", this.volume);
    } catch (error) {
      if (this.impulseUpdateTimer !== null) window.clearTimeout(this.impulseUpdateTimer);
      this.impulseUpdateTimer = null;
      await context.close();
      this.context = null;
      this.synth = null;
      this.reverbInput = null;
      this.dryGain = null;
      this.wetGain = null;
      this.convolver = null;
      this.dampingFilter = null;
      throw new Error("내장 SoundFont를 초기화하지 못했습니다.", { cause: error });
    }
  }

  private createReverbGraph(context: AudioContext): void {
    const input = context.createGain();
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const convolver = context.createConvolver();
    const dampingFilter = context.createBiquadFilter();

    dampingFilter.type = "lowpass";
    dampingFilter.Q.value = 0.35;
    convolver.buffer = createReverbImpulse(context, this.reverb.decay);

    input.connect(dryGain);
    dryGain.connect(context.destination);
    input.connect(convolver);
    convolver.connect(dampingFilter);
    dampingFilter.connect(wetGain);
    wetGain.connect(context.destination);

    this.reverbInput = input;
    this.dryGain = dryGain;
    this.wetGain = wetGain;
    this.convolver = convolver;
    this.dampingFilter = dampingFilter;
    this.applyReverbControls(true);
  }

  private applyReverbControls(immediate = false): void {
    if (!this.context || !this.dryGain || !this.wetGain || !this.dampingFilter) return;
    const now = this.context.currentTime;
    const dryLevel = Math.cos(this.reverb.mix * Math.PI * 0.5);
    const wetLevel = Math.sin(this.reverb.mix * Math.PI * 0.5);
    setAudioParam(this.dryGain.gain, dryLevel, now, immediate);
    setAudioParam(this.wetGain.gain, wetLevel, now, immediate);
    setAudioParam(this.dampingFilter.frequency, this.reverb.damp, now, immediate);
  }

  private scheduleImpulseUpdate(): void {
    if (!this.context || !this.convolver) return;
    if (this.impulseUpdateTimer !== null) window.clearTimeout(this.impulseUpdateTimer);
    this.impulseUpdateTimer = window.setTimeout(() => {
      this.impulseUpdateTimer = null;
      if (this.context && this.convolver) {
        this.convolver.buffer = createReverbImpulse(this.context, this.reverb.decay);
      }
    }, 80);
  }

  private applyPreset(): void {
    if (!this.synth) return;
    const program = SOUND_PRESETS.findIndex((item) => item.name === this.preset);
    this.synth.programChange(SYNTH_CHANNEL, program >= 0 ? program : 0);
  }
}

function createReverbImpulse(context: BaseAudioContext, decaySec: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(context.sampleRate * decaySec));
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const elapsedSec = index / context.sampleRate;
      const envelope = Math.exp((-6.9078 * elapsedSec) / decaySec);
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return impulse;
}

function setAudioParam(param: AudioParam, value: number, now: number, immediate: boolean): void {
  param.cancelScheduledValues(now);
  if (immediate) {
    param.setValueAtTime(value, now);
  } else {
    param.setTargetAtTime(value, now, 0.01);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function loadBundledSoundFont(): Promise<ArrayBuffer> {
  if (window.electronAudio?.readBundledSoundFont) {
    const bytes = await window.electronAudio.readBundledSoundFont();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  const response = await fetch(assetUrl(SOUNDFONT_PATH));
  if (!response.ok) {
    throw new Error(`SoundFont 파일을 읽지 못했습니다: ${response.status}`);
  }
  return response.arrayBuffer();
}

function assetUrl(path: string): string {
  return new URL(`./${path}`, window.location.href).href;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    electronAudio?: {
      readBundledSoundFont: () => Promise<Uint8Array>;
    };
  }
}
