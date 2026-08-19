import './style.css';
import { HandController } from './controls/HandController';
import { KeyboardController } from './controls/KeyboardController';
import { DrivingGame } from './game/DrivingGame';
import type { CarStyle, ControlMode, GameSnapshot } from './game/types';
import { CAR_MODEL_OPTIONS, DEFAULT_CAR_MODEL_ID } from './game/vehicleAssets';
import type { CarModelId } from './game/vehicleAssets';
import { cacheRealCarAssets } from './services/carAssetCache';
import type { CarAssetCacheProgress } from './services/carAssetCache';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root is missing');

app.innerHTML = `
  <main class="game-shell">
    <div id="viewport" class="viewport" aria-label="3D driving game"></div>

    <header class="topbar">
      <a class="brand" href="#" aria-label="Driftline home">
        <span class="brand-mark"></span>
        <span>DRIFTLINE</span>
      </a>
      <div class="topbar-actions">
        <div id="tracking-pill" class="tracking-pill">
          <span class="status-dot"></span><span id="tracking-label">INPUT NOT SET</span>
        </div>
        <button id="mute-button" class="icon-button" aria-label="Toggle sound">SOUND ON</button>
        <button id="pause-button" class="icon-button" aria-label="Pause game">PAUSE</button>
      </div>
    </header>

    <section id="hud" class="hud is-hidden" aria-live="polite">
      <div class="speed-panel">
        <div class="speed-number"><span id="speed">000</span><small>KM/H</small></div>
        <div class="speed-track"><span id="speed-fill"></span></div>
      </div>
      <div class="run-stats">
        <div><span>DISTANCE</span><strong id="distance">0.00 <small>KM</small></strong></div>
        <div><span>OVERTAKES</span><strong id="overtakes">0</strong></div>
        <div><span>SCORE</span><strong id="score">000000</strong></div>
      </div>
      <div id="assist" class="assist"><i></i><span>READY</span></div>
      <div class="steer-meter">
        <span>L</span><div class="steer-track"><i id="steer-indicator"></i></div><span>R</span>
      </div>
    </section>

    <aside class="camera-shell is-offline is-hidden" aria-label="Camera tracking preview">
      <video id="camera-video" playsinline muted></video>
      <canvas id="camera-canvas"></canvas>
      <div class="camera-topline"><span><i></i> HAND CAM</span><button id="hide-camera">HIDE</button></div>
      <div id="camera-hint" class="camera-hint">WAITING FOR CAMERA</div>
    </aside>
    <button id="show-camera" class="show-camera is-hidden">SHOW HAND CAM</button>

    <section id="overlay" class="overlay">
      <div class="modal intro-modal">
        <div class="eyebrow"><span></span> TWO-HAND DRIVING EXPERIENCE</div>
        <h1>YOUR HANDS.<br><em>YOUR ROAD.</em></h1>
        <p class="lead">Grip an invisible wheel. Turn naturally. Your car handles the throttle and brakes while you own every curve.</p>
        <div class="wheel-guide" aria-hidden="true">
          <div class="hand hand-left"><span></span><b>LEFT HAND</b></div>
          <div class="virtual-wheel"><span class="wheel-center"></span></div>
          <div class="hand hand-right"><span></span><b>RIGHT HAND</b></div>
        </div>
        <div class="instruction-row">
          <div><b>01</b><span>Allow camera<br>access</span></div>
          <div><b>02</b><span>Hold two closed<br>hands apart</span></div>
          <div><b>03</b><span>Rotate them<br>to steer</span></div>
        </div>
        <div class="car-style-picker" role="group" aria-label="Choose car style">
          <span>CAR STYLE</span>
          <button id="car-style-cartoon" class="car-style-option is-active" type="button" aria-pressed="true">
            <strong>CARTOON CARS</strong><small>CLASSIC MODE</small>
          </button>
          <button id="car-style-real" class="car-style-option" type="button" aria-pressed="false">
            <strong>REAL CARS</strong><small>GLTF MODELS</small>
          </button>
        </div>
        <div id="real-car-options" class="real-car-options is-disabled">
          <label>
            <span>DRIVER CAR</span>
            <select id="driver-car" aria-label="Choose driver car" disabled>
              ${CAR_MODEL_OPTIONS.map(({ id, label }) => `<option value="${id}"${id === DEFAULT_CAR_MODEL_ID ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>TRAFFIC CARS</span>
            <select id="traffic-count" aria-label="Choose number of traffic cars" disabled>
              <option value="4">4 CARS</option>
              <option value="8">8 CARS</option>
              <option value="12">12 CARS</option>
              <option value="16" selected>16 CARS</option>
            </select>
          </label>
        </div>
        <div class="modal-actions">
          <button id="camera-start" class="primary-button"><span>START WITH HANDS</span><i>→</i></button>
          <button id="keyboard-start" class="secondary-button">USE KEYBOARD INSTEAD <small>← A / D →</small></button>
        </div>
        <p class="privacy"><i>●</i> Camera processing stays on this device. No video is saved or uploaded.</p>
      </div>
    </section>

    <section id="asset-gate" class="asset-gate" role="dialog" aria-modal="true" aria-labelledby="asset-gate-title">
      <div class="modal compact-modal asset-gate-modal">
        <div class="eyebrow"><span></span> FIRST-TIME SETUP</div>
        <h2 id="asset-gate-title">PREPARING<br>YOUR GARAGE.</h2>
        <p id="asset-gate-message">Keep this page open while the real-car models are saved securely in your browser.</p>
        <div id="asset-loader" class="asset-loader" aria-hidden="true">
          <span id="asset-download-percent">0%</span>
        </div>
        <div id="asset-download" class="asset-download" data-state="checking" role="status" aria-live="polite">
          <div class="asset-download-head">
            <span id="asset-download-label">CHECKING CAR ASSETS</span>
          </div>
          <div class="asset-download-track"><i id="asset-download-fill"></i></div>
          <small id="asset-download-detail">Checking browser storage...</small>
        </div>
        <button id="asset-download-retry" class="secondary-button is-hidden" type="button">RETRY DOWNLOAD</button>
      </div>
    </section>

    <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
    <div class="corner corner-bl"></div><div class="corner corner-br"></div>
  </main>
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const viewport = byId<HTMLDivElement>('viewport');
const overlay = byId<HTMLElement>('overlay');
const hud = byId<HTMLElement>('hud');
const video = byId<HTMLVideoElement>('camera-video');
const cameraCanvas = byId<HTMLCanvasElement>('camera-canvas');
const cameraShell = document.querySelector<HTMLElement>('.camera-shell')!;
const trackingPill = byId<HTMLElement>('tracking-pill');
const trackingLabel = byId<HTMLElement>('tracking-label');
const cameraHint = byId<HTMLElement>('camera-hint');
const pauseButton = byId<HTMLButtonElement>('pause-button');

let mode: ControlMode = 'hands';
let handController: HandController | null = null;
const keyboard = new KeyboardController();
let lastSnapshot: GameSnapshot | null = null;
let soundEnabled = true;
let selectedCarStyle: CarStyle = 'cartoon';
let selectedDriverCar: CarModelId = DEFAULT_CAR_MODEL_ID;
let selectedTrafficCount = 16;

class EngineSound {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private beat = 0;
  private playing = false;

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

  update(speed: number): void {
    if (!this.context || !this.oscillator || !this.gain) return;
    this.oscillator.frequency.setTargetAtTime(48 + speed * 1.1, this.context.currentTime, 0.08);
    this.gain.gain.setTargetAtTime(soundEnabled && speed > 1 ? 0.018 + speed / 9000 : 0, this.context.currentTime, 0.12);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (playing) void this.context?.resume();
  }

  hornThreeTimes(): void {
    if (!this.context || !this.playing || !soundEnabled) return;
    const start = this.context.currentTime + 0.025;
    for (let index = 0; index < 3; index += 1) {
      this.playHornPulse(start + index * 0.34);
    }
  }

  stop(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    void this.context?.close();
  }

  private scheduleMusicBeat(): void {
    if (!this.context || !this.musicGain || !this.playing || !soundEnabled) return;
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

const engineSound = new EngineSound();

const getControl = () => {
  if (mode === 'hands') return handController?.getInput() ?? { steering: 0, confidence: 0, active: false };
  const keyboardInput = keyboard.getInput();
  return { ...keyboardInput, active: true };
};

const game = new DrivingGame(viewport, getControl, (snapshot) => {
  lastSnapshot = snapshot;
  byId('speed').textContent = Math.round(snapshot.speedKph).toString().padStart(3, '0');
  byId('speed-fill').style.width = `${Math.min(100, snapshot.speedKph / 1.62)}%`;
  byId('distance').innerHTML = `${(snapshot.distance / 1000).toFixed(2)} <small>KM</small>`;
  byId('overtakes').textContent = snapshot.overtakes.toString();
  byId('score').textContent = snapshot.score.toString().padStart(6, '0');
  byId('assist').querySelector('span')!.textContent = snapshot.assistMessage;
  const steering = getControl().steering;
  byId('steer-indicator').style.left = `${50 + steering * 46}%`;
  engineSound.update(snapshot.speedKph);
}, () => showCrash(), () => engineSound.hornThreeTimes());

let realCarAssetsReady = installRealCarAssets();

async function installRealCarAssets(): Promise<boolean> {
  const gate = byId<HTMLElement>('asset-gate');
  const retryButton = byId<HTMLButtonElement>('asset-download-retry');
  setGameLocked(true);
  gate.classList.remove('is-hidden');
  gate.dataset.state = 'loading';
  retryButton.classList.add('is-hidden');

  const cached = await cacheRealCarAssets(updateCarAssetProgress);
  if (cached) {
    gate.dataset.state = 'ready';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
    gate.classList.add('is-hidden');
    setGameLocked(false);
  } else {
    gate.dataset.state = 'error';
    retryButton.classList.remove('is-hidden');
  }
  return cached;
}

function setGameLocked(locked: boolean): void {
  const shell = document.querySelector<HTMLElement>('.game-shell');
  if (!shell) return;
  for (const child of shell.children) {
    if (child instanceof HTMLElement && child.id !== 'asset-gate') {
      child.inert = locked;
    }
  }
}

function updateCarAssetProgress(progress: CarAssetCacheProgress): void {
  const gate = document.getElementById('asset-gate');
  const title = document.getElementById('asset-gate-title');
  const messageNode = document.getElementById('asset-gate-message');
  const loader = document.getElementById('asset-loader');
  const panel = document.getElementById('asset-download');
  const label = document.getElementById('asset-download-label');
  const percentNode = document.getElementById('asset-download-percent');
  const fill = document.getElementById('asset-download-fill');
  const detail = document.getElementById('asset-download-detail');
  if (!gate || !title || !messageNode || !loader || !panel || !label || !percentNode || !fill || !detail) return;

  const checkingRatio = progress.totalFiles > 0
    ? progress.checkedFiles / progress.totalFiles
    : 0;
  const downloadRatio = progress.totalBytes > 0
    ? progress.loadedBytes / progress.totalBytes
    : 0;
  const ratio = progress.phase === 'checking' ? checkingRatio : downloadRatio;
  const percent = progress.phase === 'ready'
    ? 100
    : Math.max(0, Math.min(99, Math.round(ratio * 100)));

  panel.dataset.state = progress.phase;
  loader.style.setProperty('--download-progress', `${percent * 3.6}deg`);
  percentNode.textContent = `${percent}%`;
  fill.style.width = `${percent}%`;

  if (progress.phase === 'checking') {
    label.textContent = 'CHECKING BROWSER STORAGE';
    detail.textContent = progress.totalFiles > 0
      ? `${progress.checkedFiles} / ${progress.totalFiles} files checked`
      : 'Looking for previously downloaded real-car assets...';
  } else if (progress.phase === 'downloading') {
    label.textContent = 'DOWNLOADING REAL-CAR ASSETS';
    detail.textContent = `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)} saved · ${progress.completedFiles} / ${progress.totalFiles} files`;
  } else if (progress.phase === 'ready') {
    title.innerHTML = 'GARAGE<br>READY.';
    messageNode.textContent = 'All real-car assets are stored. Opening the game...';
    label.textContent = 'REAL-CAR ASSETS READY';
    detail.textContent = `${formatBytes(progress.totalBytes)} saved in browser storage for future visits.`;
  } else {
    title.innerHTML = 'DOWNLOAD<br>INTERRUPTED.';
    messageNode.textContent = 'The game stays locked until every required asset is safely downloaded.';
    label.textContent = 'ASSET DOWNLOAD FAILED';
    percentNode.textContent = '!';
    loader.style.setProperty('--download-progress', '360deg');
    detail.textContent = progress.message ?? 'Check your connection and available browser storage, then retry.';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

byId('asset-download-retry').addEventListener('click', () => {
  realCarAssetsReady = installRealCarAssets();
});

function selectCarStyle(style: CarStyle): void {
  selectedCarStyle = style;
  for (const option of ['real', 'cartoon'] as const) {
    const button = byId<HTMLButtonElement>(`car-style-${option}`);
    const active = option === style;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active.toString());
  }
  const realOptions = byId<HTMLElement>('real-car-options');
  const disabled = style !== 'real';
  realOptions.classList.toggle('is-disabled', disabled);
  for (const select of realOptions.querySelectorAll<HTMLSelectElement>('select')) {
    select.disabled = disabled;
  }
}

byId('car-style-real').addEventListener('click', () => selectCarStyle('real'));
byId('car-style-cartoon').addEventListener('click', () => selectCarStyle('cartoon'));
byId<HTMLSelectElement>('driver-car').addEventListener('change', (event) => {
  selectedDriverCar = (event.currentTarget as HTMLSelectElement).value as CarModelId;
});
byId<HTMLSelectElement>('traffic-count').addEventListener('change', (event) => {
  selectedTrafficCount = Number((event.currentTarget as HTMLSelectElement).value);
});

async function prepareSelectedCars(button?: HTMLButtonElement): Promise<void> {
  const originalContent = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.textContent = selectedCarStyle === 'real' ? 'LOADING REAL CARS…' : 'PREPARING…';
  }
  try {
    if (selectedCarStyle === 'real') await realCarAssetsReady;
    await game.setCarStyle(
      selectedCarStyle,
      selectedDriverCar,
      selectedTrafficCount,
    );
  } finally {
    if (button && originalContent !== undefined) {
      button.innerHTML = originalContent;
      button.disabled = false;
    }
  }
}

function setTracking(text: string, state: 'ok' | 'warn' | 'off' = 'off'): void {
  trackingLabel.textContent = text;
  trackingPill.dataset.state = state;
}

function showDriveReady(title: string, message: string): void {
  overlay.classList.remove('is-hidden');
  overlay.innerHTML = `
    <div class="modal compact-modal">
      <div class="eyebrow"><span></span> SYSTEM READY</div>
      <h2>${title}</h2>
      <p>${message}</p>
      <button id="begin-run" class="primary-button"><span>START THE RUN</span><i>→</i></button>
    </div>`;
  byId('begin-run').addEventListener('click', beginRun);
}

function beginRun(): void {
  engineSound.start();
  engineSound.setPlaying(true);
  overlay.classList.add('is-hidden');
  hud.classList.remove('is-hidden');
  game.start();
  pauseButton.textContent = 'PAUSE';
}

function showCrash(): void {
  engineSound.setPlaying(false);
  const snapshot = lastSnapshot;
  overlay.classList.remove('is-hidden');
  overlay.innerHTML = `
    <div class="modal compact-modal crash-modal">
      <div class="eyebrow danger"><span></span> RUN ENDED</div>
      <h2>IMPACT.</h2>
      <p>The road always wins eventually. Reset, refocus, and take the next line cleaner.</p>
      <div class="final-stats">
        <div><span>DISTANCE</span><b>${((snapshot?.distance ?? 0) / 1000).toFixed(2)} KM</b></div>
        <div><span>OVERTAKES</span><b>${snapshot?.overtakes ?? 0}</b></div>
        <div><span>SCORE</span><b>${snapshot?.score ?? 0}</b></div>
      </div>
      <button id="restart-run" class="primary-button"><span>DRIVE AGAIN</span><i>↻</i></button>
    </div>`;
  byId('restart-run').addEventListener('click', beginRun);
}

byId<HTMLButtonElement>('camera-start').addEventListener('click', async (event) => {
  await prepareSelectedCars(event.currentTarget as HTMLButtonElement);
  mode = 'hands';
  engineSound.start();
  cameraShell.classList.remove('is-offline', 'is-hidden');
  cameraShell.classList.add('is-calibrating');
  overlay.innerHTML = `
    <div class="modal compact-modal calibration-modal">
      <div class="eyebrow"><span></span> CALIBRATING</div>
      <h2>HOLD THE WHEEL.</h2>
      <p>Keep two closed hands apart and level. Hold steady while we find your neutral position.</p>
      <div class="calibration-ring"><span id="calibration-percent">0%</span></div>
      <button id="cancel-camera" class="secondary-button">USE KEYBOARD INSTEAD</button>
    </div>`;
  byId('cancel-camera').addEventListener('click', useKeyboard);
  setTracking('LOADING HAND MODEL', 'warn');
  cameraHint.textContent = 'LOADING TRACKER';

  handController = new HandController(video, cameraCanvas, (status, progress = 0) => {
    const percent = Math.min(100, Math.round(progress * 100));
    const percentNode = document.getElementById('calibration-percent');
    if (percentNode) percentNode.textContent = `${percent}%`;
    const ring = document.querySelector<HTMLElement>('.calibration-ring');
    if (ring) ring.style.setProperty('--progress', `${percent * 3.6}deg`);

    if (status === 'calibrating') {
      setTracking('HOLD BOTH FISTS', 'warn');
      cameraHint.textContent = progress > 0 ? 'HOLD STEADY' : 'SHOW TWO CLOSED HANDS';
    } else if (status === 'tracking') {
      cameraShell.classList.remove('is-calibrating');
      setTracking('HANDS TRACKED', 'ok');
      cameraHint.textContent = 'STEERING ACTIVE';
      if (game.getPhase() !== 'playing' && !document.getElementById('begin-run')) {
        showDriveReady('CALIBRATION LOCKED.', 'Turn your hands like a wheel. The car will manage its own speed and brake for traffic.');
      }
    } else if (status === 'lost') {
      setTracking('HANDS LOST', 'warn');
      cameraHint.textContent = 'SHOW TWO CLOSED HANDS';
    } else if (status === 'error') {
      cameraShell.classList.remove('is-calibrating');
      setTracking('CAMERA UNAVAILABLE', 'off');
      cameraShell.classList.add('is-offline');
      showDriveReady('KEYBOARD MODE.', 'Camera access was unavailable. Use A / D or the arrow keys to steer.');
      mode = 'keyboard';
    }
  });

  try {
    await handController.start();
  } catch {
    mode = 'keyboard';
  }
});

async function useKeyboard(): Promise<void> {
  const startButton = document.getElementById('keyboard-start') as HTMLButtonElement | null;
  await prepareSelectedCars(startButton ?? undefined);
  mode = 'keyboard';
  handController?.stop();
  cameraShell.classList.remove('is-calibrating');
  cameraShell.classList.add('is-offline', 'is-hidden');
  setTracking('KEYBOARD CONTROL', 'ok');
  cameraHint.textContent = 'CAMERA OFF';
  showDriveReady('KEYBOARD READY.', 'Use A / D or the left and right arrow keys. Acceleration and braking remain automatic.');
}

byId('keyboard-start').addEventListener('click', useKeyboard);

pauseButton.addEventListener('click', () => {
  if (game.getPhase() === 'playing') {
    game.pause();
    engineSound.setPlaying(false);
    pauseButton.textContent = 'RESUME';
    overlay.classList.remove('is-hidden');
    overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="eyebrow"><span></span> RUN PAUSED</div>
        <h2>TAKE A BREATH.</h2>
        <p>The road is waiting exactly where you left it.</p>
        <button id="resume-run" class="primary-button"><span>RESUME DRIVE</span><i>→</i></button>
      </div>`;
    byId('resume-run').addEventListener('click', () => {
      game.resume();
      engineSound.setPlaying(true);
      overlay.classList.add('is-hidden');
      pauseButton.textContent = 'PAUSE';
    });
  } else if (game.getPhase() === 'paused') {
    game.resume();
    engineSound.setPlaying(true);
    overlay.classList.add('is-hidden');
    pauseButton.textContent = 'PAUSE';
  }
});

byId('hide-camera').addEventListener('click', () => {
  cameraShell.classList.add('is-hidden');
  byId('show-camera').classList.remove('is-hidden');
});

byId('show-camera').addEventListener('click', () => {
  cameraShell.classList.remove('is-hidden');
  byId('show-camera').classList.add('is-hidden');
});

byId('mute-button').addEventListener('click', (event) => {
  soundEnabled = !soundEnabled;
  (event.currentTarget as HTMLButtonElement).textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') pauseButton.click();
});

window.addEventListener('beforeunload', () => {
  handController?.stop();
  keyboard.dispose();
  engineSound.stop();
  game.dispose();
});
