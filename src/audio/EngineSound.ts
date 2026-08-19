/**
 * Owns all procedural game audio. Keeping Web Audio nodes behind this class
 * prevents UI and game-state code from depending on the audio graph.
 */
export class EngineSound {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private beat = 0;
  private playing = false;
  private enabled = true;

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
    this.musicTimer = window.setInterval(() => this.scheduleMusicBeat(), 250);
  }

  update(speedKph: number): void {
    if (!this.context || !this.oscillator || !this.gain) return;
    this.oscillator.frequency.setTargetAtTime(
      48 + speedKph * 1.1,
      this.context.currentTime,
      0.08,
    );
    const volume = this.enabled && speedKph > 1 ? 0.018 + speedKph / 9000 : 0;
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.12);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (playing) void this.context?.resume();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.context && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
    }
  }

  hornThreeTimes(): void {
    if (!this.context || !this.playing || !this.enabled) return;
    const start = this.context.currentTime + 0.025;
    for (let index = 0; index < 3; index += 1) {
      this.playHornPulse(start + index * 0.34);
    }
  }

  stop(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    void this.context?.close();
    this.context = null;
  }

  private scheduleMusicBeat(): void {
    if (!this.context || !this.musicGain || !this.playing || !this.enabled) return;
    const now = this.context.currentTime;
    const bassNotes = [55, 55, 65.41, 55, 73.42, 65.41, 49, 49];
    const leadNotes = [220, 246.94, 293.66, 329.63, 293.66, 246.94, 196, 220];
    this.playNote(bassNotes[this.beat % bassNotes.length], now, 0.22, 'sawtooth', 0.18, 420);
    if (this.beat % 2 === 0) {
      this.playNote(leadNotes[(this.beat / 2) % leadNotes.length], now + 0.02, 0.18, 'triangle', 0.11, 1400);
    }
    if (this.beat % 4 === 0) this.playKick(now);
    if (this.beat % 4 === 2) this.playNoise(now, 0.045);
    this.beat += 1;
  }

  private playHornPulse(start: number): void {
    if (!this.context) return;
    const envelope = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const lowTone = this.context.createOscillator();
    const highTone = this.context.createOscillator();
    lowTone.type = 'sawtooth';
    highTone.type = 'square';
    lowTone.frequency.setValueAtTime(370, start);
    highTone.frequency.setValueAtTime(466, start);
    filter.type = 'lowpass';
    filter.frequency.value = 1350;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.055, start + 0.018);
    envelope.gain.setValueAtTime(0.055, start + 0.13);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);
    lowTone.connect(filter);
    highTone.connect(filter);
    filter.connect(envelope).connect(this.context.destination);
    lowTone.start(start);
    highTone.start(start);
    lowTone.stop(start + 0.23);
    highTone.stop(start + 0.23);
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
