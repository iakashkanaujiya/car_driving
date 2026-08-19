import { EngineSound } from '../audio/EngineSound';
import type { HandController } from '../controls/HandController';
import { KeyboardController } from '../controls/KeyboardController';
import type { DrivingGame } from '../game/DrivingGame';
import type { ControlInput, ControlMode, GameSnapshot } from '../game/types';
import { DEFAULT_CAR_MODEL_ID } from '../game/vehicleCatalog';
import type { CarModelId } from '../game/vehicleCatalog';
import { cacheAssets } from '../services/assetCache';
import { AssetGate } from '../ui/AssetGate';
import { byId } from '../ui/dom';
import { GameHud } from '../ui/GameHud';

type TrackingState = 'ok' | 'warn' | 'off';

/** Coordinates UI intent with the input, audio, asset, and game subsystems. */
export class DrivingApplication {
  private readonly events = new AbortController();
  private readonly keyboard = new KeyboardController();
  private readonly audio = new EngineSound();
  private readonly hud = new GameHud();
  private readonly assetGate = new AssetGate();
  private readonly viewport = byId<HTMLDivElement>('viewport');
  private readonly gameShell = document.querySelector<HTMLElement>('.game-shell');
  private readonly overlay = byId<HTMLElement>('overlay');
  private readonly video = byId<HTMLVideoElement>('camera-video');
  private readonly cameraCanvas = byId<HTMLCanvasElement>('camera-canvas');
  private readonly cameraShell = document.querySelector<HTMLElement>('.camera-shell');
  private readonly trackingPill = byId<HTMLElement>('tracking-pill');
  private readonly trackingLabel = byId<HTMLElement>('tracking-label');
  private readonly cameraHint = byId<HTMLElement>('camera-hint');
  private readonly pauseButton = byId<HTMLButtonElement>('pause-button');
  private readonly fullscreenButton = byId<HTMLButtonElement>('fullscreen-button');

  private game: DrivingGame | null = null;
  private handController: HandController | null = null;
  private mode: ControlMode = 'hands';
  private lastSnapshot: GameSnapshot | null = null;
  private soundEnabled = true;
  private driverCar: CarModelId = DEFAULT_CAR_MODEL_ID;
  private trafficCount = 4;
  private modelCount = 1;
  private assetsReady: Promise<boolean> = Promise.resolve(false);
  private sceneReady: Promise<boolean> = Promise.resolve(false);

  constructor() {
    if (!this.gameShell || !this.cameraShell) throw new Error('The game shell is incomplete.');
  }

  start(): void {
    this.fullscreenButton.hidden = !document.fullscreenEnabled;
    this.bindUiEvents();
    this.assetsReady = this.installAssets();
  }

  dispose(): void {
    this.events.abort();
    this.handController?.stop();
    this.keyboard.dispose();
    this.audio.stop();
    this.game?.dispose();
  }

  private bindUiEvents(): void {
    const options = { signal: this.events.signal };
    this.assetGate.retryButton.addEventListener('click', () => {
      this.assetsReady = this.installAssets();
    }, options);
    byId<HTMLSelectElement>('driver-car').addEventListener('change', (event) => {
      this.driverCar = (event.currentTarget as HTMLSelectElement).value as CarModelId;
    }, options);
    byId<HTMLSelectElement>('traffic-count').addEventListener('change', (event) => {
      this.trafficCount = Number((event.currentTarget as HTMLSelectElement).value);
    }, options);
    byId<HTMLSelectElement>('car-model-count').addEventListener('change', (event) => {
      this.modelCount = Number((event.currentTarget as HTMLSelectElement).value);
    }, options);
    byId<HTMLButtonElement>('camera-start').addEventListener('click', (event) => {
      void this.useHandControls(event.currentTarget as HTMLButtonElement);
    }, options);
    byId('keyboard-start').addEventListener('click', () => void this.useKeyboard(), options);
    this.pauseButton.addEventListener('click', () => this.togglePause(), options);
    byId('hide-camera').addEventListener('click', () => this.setCameraVisible(false), options);
    byId('show-camera').addEventListener('click', () => this.setCameraVisible(true), options);
    byId<HTMLButtonElement>('mute-button').addEventListener('click', (event) => {
      this.soundEnabled = !this.soundEnabled;
      this.audio.setEnabled(this.soundEnabled);
      (event.currentTarget as HTMLButtonElement).textContent = this.soundEnabled ? 'SOUND ON' : 'SOUND OFF';
    }, options);
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen(), options);
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange(), options);
    document.addEventListener('visibilitychange', () => {
      this.handController?.setPaused(document.hidden);
    }, options);
    window.addEventListener('keydown', (event) => this.onGlobalKeyDown(event), options);
    window.addEventListener('beforeunload', () => this.dispose(), { once: true });
  }

  private async installAssets(): Promise<boolean> {
    this.assetGate.begin();
    const cached = await cacheAssets((progress) => this.assetGate.update(progress));
    if (!cached) {
      this.assetGate.showError();
      return false;
    }

    this.assetGate.markPreparing();
    if (!this.game) {
      this.game = await this.createGame();
      this.sceneReady = this.game.whenReady().then(
        () => true,
        (error) => {
          console.error('Could not prepare all scene assets.', error);
          return false;
        },
      );
    }
    if (!(await this.sceneReady)) {
      this.assetGate.markPreparationError();
      this.assetGate.showError();
      return false;
    }

    this.assetGate.markReady();
    await this.assetGate.finish();
    return true;
  }

  private async createGame(): Promise<DrivingGame> {
    const { DrivingGame } = await import('../game/DrivingGame');
    return new DrivingGame(
      this.viewport,
      () => this.getControl(),
      (snapshot) => {
        this.lastSnapshot = snapshot;
        this.hud.update(snapshot, this.getControl().steering);
        this.audio.update(snapshot.speedKph);
      },
      () => this.showCrash(),
      () => this.audio.hornThreeTimes(),
    );
  }

  private getControl(): ControlInput {
    if (this.mode === 'hands') {
      return this.handController?.getInput() ?? { steering: 0, confidence: 0, active: false };
    }
    // Keyboard mode remains active while keys are released so coasting works.
    return { ...this.keyboard.getInput(), active: true };
  }

  private async prepareSelectedCars(button?: HTMLButtonElement): Promise<boolean> {
    const originalContent = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.textContent = 'LOADING GAME...';
    }
    try {
      const [assetsAvailable, sceneAvailable] = await Promise.all([this.assetsReady, this.sceneReady]);
      if (!assetsAvailable || !sceneAvailable || !this.game) throw new Error('Required assets are unavailable.');
      await this.game.setCars(this.driverCar, this.trafficCount, this.modelCount);
      return true;
    } catch (error) {
      console.error('Could not prepare the game.', error);
      this.showGameLoadError();
      return false;
    } finally {
      if (button && originalContent !== undefined) {
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
  }

  private async useHandControls(button: HTMLButtonElement): Promise<void> {
    if (!(await this.prepareSelectedCars(button))) return;
    this.mode = 'hands';
    this.audio.start();
    this.cameraShell!.classList.remove('is-offline', 'is-hidden');
    this.cameraShell!.classList.add('is-calibrating');
    this.overlay.innerHTML = `
      <div class="modal compact-modal calibration-modal">
        <div class="eyebrow"><span></span> CALIBRATING</div>
        <h2>HOLD THE WHEEL.</h2>
        <p>Keep two closed hands apart and level. Hold steady while we find your neutral position.</p>
        <div class="calibration-ring"><span id="calibration-percent">0%</span></div>
        <button id="cancel-camera" class="secondary-button">USE KEYBOARD INSTEAD</button>
      </div>`;
    byId('cancel-camera').addEventListener('click', () => void this.useKeyboard(), { signal: this.events.signal });
    this.setTracking('LOADING HAND MODEL', 'warn');
    this.cameraHint.textContent = 'LOADING TRACKER';

    this.handController?.stop();
    // MediaPipe is a large optional dependency; keyboard players never need to
    // download or parse it, so load the controller only after hand mode wins.
    const { HandController } = await import('../controls/HandController');
    this.handController = new HandController(
      this.video,
      this.cameraCanvas,
      (status, progress = 0) => this.onHandStatus(status, progress),
    );
    try {
      await this.handController.start();
    } catch {
      this.mode = 'keyboard';
    }
  }

  private onHandStatus(status: string, progress: number): void {
    const percent = Math.min(100, Math.round(progress * 100));
    document.getElementById('calibration-percent')?.replaceChildren(`${percent}%`);
    document.querySelector<HTMLElement>('.calibration-ring')?.style.setProperty('--progress', `${percent * 3.6}deg`);

    if (status === 'calibrating') {
      this.setTracking('HOLD BOTH FISTS', 'warn');
      this.cameraHint.textContent = progress > 0 ? 'HOLD STEADY' : 'SHOW TWO CLOSED HANDS';
    } else if (status === 'tracking') {
      this.cameraShell!.classList.remove('is-calibrating');
      this.setTracking('HANDS TRACKED', 'ok');
      this.cameraHint.textContent = 'STEERING ACTIVE';
      if (this.game?.getPhase() !== 'playing' && !document.getElementById('begin-run')) {
        this.showDriveReady('CALIBRATION LOCKED.', 'Turn your hands like a wheel. Raise both thumbs to brake; otherwise the car manages its own speed.');
      }
    } else if (status === 'lost') {
      this.setTracking('HANDS LOST', 'warn');
      this.cameraHint.textContent = 'SHOW TWO CLOSED HANDS';
    } else if (status === 'error') {
      this.cameraShell!.classList.remove('is-calibrating');
      this.cameraShell!.classList.add('is-offline');
      this.setTracking('CAMERA UNAVAILABLE');
      this.mode = 'keyboard';
      this.showKeyboardReady();
    }
  }

  private async useKeyboard(): Promise<void> {
    const button = document.getElementById('keyboard-start') as HTMLButtonElement | null;
    if (!(await this.prepareSelectedCars(button ?? undefined))) return;
    this.mode = 'keyboard';
    this.handController?.stop();
    this.cameraShell!.classList.remove('is-calibrating');
    this.cameraShell!.classList.add('is-offline', 'is-hidden');
    this.setTracking('KEYBOARD CONTROL', 'ok');
    this.cameraHint.textContent = 'CAMERA OFF';
    this.showKeyboardReady();
  }

  private showKeyboardReady(): void {
    this.showDriveReady(
      'KEYBOARD READY.',
      'Use W or ↑ to accelerate, S or ↓ to brake, and A / D or ← / → to steer. Braking stops the car without reversing.',
    );
  }

  private showDriveReady(title: string, message: string): void {
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="eyebrow"><span></span> SYSTEM READY</div>
        <h2>${title}</h2><p>${message}</p>
        <button id="begin-run" class="primary-button"><span>START THE RUN</span><i>→</i></button>
      </div>`;
    byId('begin-run').addEventListener('click', () => this.beginRun(), { signal: this.events.signal });
  }

  private beginRun(): void {
    if (!this.game) return;
    this.audio.start();
    this.audio.setPlaying(true);
    this.overlay.classList.add('is-hidden');
    this.hud.show();
    this.game.start();
    this.pauseButton.textContent = 'PAUSE';
  }

  private showCrash(): void {
    this.audio.setPlaying(false);
    const snapshot = this.lastSnapshot;
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = `
      <div class="modal compact-modal crash-modal">
        <div class="eyebrow danger"><span></span> RUN ENDED</div>
        <h2>IMPACT.</h2><p>The road always wins eventually. Reset, refocus, and take the next line cleaner.</p>
        <div class="final-stats">
          <div><span>DISTANCE</span><b>${((snapshot?.distance ?? 0) / 1000).toFixed(2)} KM</b></div>
          <div><span>OVERTAKES</span><b>${snapshot?.overtakes ?? 0}</b></div>
          <div><span>SCORE</span><b>${snapshot?.score ?? 0}</b></div>
        </div>
        <button id="restart-run" class="primary-button"><span>DRIVE AGAIN</span><i>↻</i></button>
      </div>`;
    byId('restart-run').addEventListener('click', () => this.beginRun(), { signal: this.events.signal });
  }

  private togglePause(): void {
    if (!this.game) return;
    if (this.game.getPhase() === 'playing') {
      this.game.pause();
      this.audio.setPlaying(false);
      this.pauseButton.textContent = 'RESUME';
      this.overlay.classList.remove('is-hidden');
      this.overlay.innerHTML = `
        <div class="modal compact-modal">
          <div class="eyebrow"><span></span> RUN PAUSED</div>
          <h2>TAKE A BREATH.</h2><p>The road is waiting exactly where you left it.</p>
          <button id="resume-run" class="primary-button"><span>RESUME DRIVE</span><i>→</i></button>
        </div>`;
      byId('resume-run').addEventListener('click', () => this.resumeRun(), { signal: this.events.signal });
    } else if (this.game.getPhase() === 'paused') {
      this.resumeRun();
    }
  }

  private resumeRun(): void {
    this.game?.resume();
    this.audio.setPlaying(true);
    this.overlay.classList.add('is-hidden');
    this.pauseButton.textContent = 'PAUSE';
  }

  private showGameLoadError(): void {
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="eyebrow danger"><span></span> LOADING INTERRUPTED</div>
        <h2>ASSETS NOT READY.</h2>
        <p>The game will not start until every required texture and model has loaded. Check your connection and try again.</p>
        <button id="reload-game" class="secondary-button">RELOAD GAME</button>
      </div>`;
    byId('reload-game').addEventListener('click', () => window.location.reload(), { signal: this.events.signal });
  }

  private setTracking(text: string, state: TrackingState = 'off'): void {
    this.trackingLabel.textContent = text;
    this.trackingPill.dataset.state = state;
  }

  private setCameraVisible(visible: boolean): void {
    this.cameraShell!.classList.toggle('is-hidden', !visible);
    byId('show-camera').classList.toggle('is-hidden', visible);
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.gameShell!.requestFullscreen();
  }

  private onFullscreenChange(): void {
    const active = document.fullscreenElement !== null;
    this.fullscreenButton.textContent = active ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
    this.fullscreenButton.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
    this.fullscreenButton.setAttribute('aria-pressed', active.toString());
    requestAnimationFrame(() => requestAnimationFrame(() => this.game?.refreshViewport()));
  }

  private onGlobalKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Escape') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else this.pauseButton.click();
  }
}
