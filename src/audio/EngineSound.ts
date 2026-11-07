/** Rain sits under the engine and music as a soft background patter. */
const RAIN_VOLUME = 0.014;
const HORN_VOLUME = 0.055;
/** A quick tap still honks for at least this long, in seconds. */
const HORN_MIN_SECONDS = 0.14;

interface HornVoice {
  envelope: GainNode;
  tones: OscillatorNode[];
  startedAt: number;
}

/**
 * Owns all procedural game audio. Keeping Web Audio nodes behind this class
 * prevents UI and game-state code from depending on the audio graph.
 */
export class EngineSound {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private horn: HornVoice | null = null;
  private musicTimer: number | null = null;
  private beat = 0;
  private playing = false;
  private enabled = true;
  private rainIntensity = 0;

  start(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.oscillator = this.context.createOscillator();
    this.gain = this.context.createGain();
    this.musicGain = this.context.createGain();
    this.oscillator.type = 'sawtooth';
    this.oscillator.frequency.value = 54;
    this.gain.gain.value = 0.025;
    this.musicGain.gain.value = 0.13;

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    this.oscillator.connect(filter).connect(this.gain).connect(this.context.destination);
    this.musicGain.connect(this.context.destination);
    this.oscillator.start();
    this.startRainLoop();
    this.musicTimer = window.setInterval(() => this.scheduleMusicBeat(), 250);
  }

  /** Sets the rainfall heard while driving (0 is dry). */
  setRain(intensity: number): void {
    this.rainIntensity = Math.min(1, Math.max(0, intensity));
    this.refreshRain();
  }

  update(speedKph: number): void {
    if (!this.context || !this.oscillator || !this.gain) return;
    this.oscillator.frequency.setTargetAtTime(48 + speedKph * 1.1, this.context.currentTime, 0.08);
    const volume = this.enabled && speedKph > 1 ? 0.018 + speedKph / 9000 : 0;
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.12);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (playing) void this.context?.resume();
    else this.setHorn(false);
    this.refreshRain();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.context && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
    }
    if (!enabled) this.setHorn(false);
    this.refreshRain();
  }

  /** Sounds the horn for as long as the player holds it down. */
  setHorn(pressed: boolean): void {
    if (pressed) this.startHorn();
    else this.releaseHorn();
  }

  stop(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.horn = null;
    void this.context?.close();
    this.context = null;
  }

  /** A looping band of filtered noise reads as steady rain on the bodywork. */
  private startRainLoop(): void {
    if (!this.context) return;
    const seconds = 2;
    const frameCount = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 500;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1700;
    this.rainGain = this.context.createGain();
    this.rainGain.gain.value = 0;
    source.connect(highpass).connect(lowpass).connect(this.rainGain);
    this.rainGain.connect(this.context.destination);
    source.start();
    this.refreshRain();
  }

  private refreshRain(): void {
    if (!this.context || !this.rainGain) return;
    const volume = this.enabled && this.playing ? this.rainIntensity * RAIN_VOLUME : 0;
    this.rainGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.3);
  }

  private scheduleMusicBeat(): void {
    if (!this.context || !this.musicGain || !this.playing || !this.enabled) return;
    const now = this.context.currentTime;
    const bassNotes = [55, 55, 65.41, 55, 73.42, 65.41, 49, 49];
    const leadNotes = [220, 246.94, 293.66, 329.63, 293.66, 246.94, 196, 220];
    this.playNote(bassNotes[this.beat % bassNotes.length], now, 0.22, 'sawtooth', 0.18, 420);
    if (this.beat % 2 === 0) {
      this.playNote(
        leadNotes[(this.beat / 2) % leadNotes.length],
        now + 0.02,
        0.18,
        'triangle',
        0.11,
        1400,
      );
    }
    if (this.beat % 4 === 0) this.playKick(now);
    if (this.beat % 4 === 2) this.playNoise(now, 0.045);
    this.beat += 1;
  }

  private startHorn(): void {
    if (!this.context || this.horn || !this.playing || !this.enabled) return;
    const start = this.context.currentTime;
    const envelope = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    // Two detuned tones a major third apart, like a dual-note car horn.
    const tones = [370, 466].map((frequency, index) => {
      const tone = this.context!.createOscillator();
      tone.type = index === 0 ? 'sawtooth' : 'square';
      tone.frequency.setValueAtTime(frequency, start);
      tone.connect(filter);
      tone.start(start);
      return tone;
    });
    filter.type = 'lowpass';
    filter.frequency.value = 1350;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(HORN_VOLUME, start + 0.018);
    filter.connect(envelope).connect(this.context.destination);
    this.horn = { envelope, tones, startedAt: start };
  }

  private releaseHorn(): void {
    if (!this.context || !this.horn) return;
    const { envelope, tones, startedAt } = this.horn;
    this.horn = null;
    const release = Math.max(this.context.currentTime, startedAt + HORN_MIN_SECONDS);
    envelope.gain.setValueAtTime(HORN_VOLUME, release);
    envelope.gain.exponentialRampToValueAtTime(0.0001, release + 0.08);
    for (const tone of tones) tone.stop(release + 0.1);
  }

  private playNote(
    frequency: number,
    start: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    cutoff: number,
  ): void {
    if (!this.context || !this.musicGain) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter).connect(envelope).connect(this.musicGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private playKick(start: number): void {
    if (!this.context || !this.musicGain) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(120, start);
    oscillator.frequency.exponentialRampToValueAtTime(42, start + 0.12);
    envelope.gain.setValueAtTime(0.25, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(envelope).connect(this.musicGain);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  }

  private playNoise(start: number, volume: number): void {
    if (!this.context || !this.musicGain) return;
    const frameCount = Math.floor(this.context.sampleRate * 0.055);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 3200;
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    source.connect(filter).connect(envelope).connect(this.musicGain);
    source.start(start);
  }
}
