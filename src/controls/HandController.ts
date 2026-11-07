import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { HAND_REVERSE } from '../game/config';
import { damp, steeringFromHands } from '../game/math';
import type { ControlInput } from '../game/types';
import { isClosedHand, isOpenPalm, isThumbUp, SustainedGesture } from './handGestures';
import type { HandTrackingResult, HandWorkerInput, HandWorkerOutput } from './handWorkerTypes';
import {
  defaultWheelPose,
  drawSteeringWheel,
  smoothWheelPose,
  wheelPoseFromHands,
} from './steeringWheelOverlay';
import type { WheelPose, WheelState } from './steeringWheelOverlay';

type TrackingStatus = 'idle' | 'loading' | 'ready' | 'calibrating' | 'tracking' | 'lost' | 'error';
const INFERENCE_INTERVAL_MS = 1000 / 20;
// The wheel animates every camera frame (capped) for smooth motion between
// 20 Hz tracking results.
const PREVIEW_INTERVAL_MS = 1000 / 30;
const CALIBRATION_SAMPLES = 45;
/** After losing the hands for this long, the ghost wheel drifts back to centre. */
const WHEEL_RETURN_MS = 1500;
const BRAKE_GESTURE_HOLD_MS = 180;

export class HandController {
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private raf = 0;
  private videoFrameCallback = 0;
  private lastVideoTime = -1;
  private lastInferenceTime = 0;
  private frameInFlight = false;
  private switchingToFallback = false;
  private cancelWorkerInitialization: (() => void) | null = null;
  private neutralAngle = 0;
  private calibrationAngles: number[] = [];
  private input: ControlInput = { steering: 0, confidence: 0, active: false };
  private readonly brakeGesture = new SustainedGesture(BRAKE_GESTURE_HOLD_MS);
  private status: TrackingStatus = 'idle';
  private lastSeen = 0;
  private previewVisible = true;
  private lastPreviewTime = 0;
  private previewContext: CanvasRenderingContext2D | null = null;
  private wheelTarget: WheelPose | null = null;
  private wheelPose: WheelPose | null = null;
  private wheelAlpha = 0;
  private wheelGrip = false;
  private lastWheelSeen = 0;
  private paused = false;
  private stopped = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly onStatus: (status: TrackingStatus, progress?: number) => void,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.setStatus('loading');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (this.stopped) return;

      const wasmRoot = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href)
        .href;
      const localModel = new URL(
        `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`,
        window.location.href,
      ).href;
      try {
        await this.startWorker(wasmRoot, localModel);
      } catch (workerError) {
        if (this.stopped) return;
        console.warn('Hand tracking worker unavailable; using main-thread fallback.', workerError);
        await this.initializeMainThreadLandmarker(wasmRoot, localModel);
      }
      if (this.stopped) {
        this.landmarker?.close();
        this.landmarker = null;
        this.worker?.terminate();
        this.worker = null;
        return;
      }
      this.setStatus('ready');
      this.beginCalibration();
      this.scheduleNextFrame();
    } catch (error) {
      if (this.stopped) return;
      console.warn('Hand tracking unavailable:', error);
      this.setStatus('error');
      throw error;
    }
  }

  private async startWorker(wasmRoot: string, modelAssetPath: string): Promise<void> {
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
      throw new Error('Required worker camera APIs are unavailable.');
    }

    const worker = new Worker(new URL('./handTracking.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Hand tracking worker initialization timed out.')),
        20_000,
      );
      this.cancelWorkerInitialization = (): void => {
        window.clearTimeout(timeout);
        reject(new Error('Hand tracking worker initialization was cancelled.'));
      };
      worker.onmessage = (event: MessageEvent<HandWorkerOutput>): void => {
        if (event.data.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
        } else if (event.data.type === 'error') {
          window.clearTimeout(timeout);
          reject(new Error(event.data.message));
        }
      };
      worker.onerror = (event): void => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || 'The hand tracking worker failed to start.'));
      };
      const message: HandWorkerInput = { type: 'init', wasmRoot, modelAssetPath };
      worker.postMessage(message);
    })
      .catch((error) => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        throw error;
      })
      .finally(() => {
        this.cancelWorkerInitialization = null;
      });

    worker.onmessage = this.handleWorkerMessage;
    worker.onerror = (event): void => {
      void this.activateMainThreadFallback(
        new Error(event.message || 'Hand tracking worker stopped.'),
      );
    };
  }

  private async initializeMainThreadLandmarker(
    wasmRoot: string,
    localModel: string,
  ): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    try {
      this.landmarker = await this.createLandmarker(vision, localModel, 'GPU');
    } catch {
      try {
        this.landmarker = await this.createLandmarker(vision, localModel, 'CPU');
      } catch {
        this.landmarker = await this.createLandmarker(
          vision,
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          'CPU',
        );
      }
    }
  }

  private createLandmarker(
    vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    modelAssetPath: string,
    delegate: 'GPU' | 'CPU',
  ) {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  beginCalibration(): void {
    this.calibrationAngles = [];
    this.input = { steering: 0, confidence: 0, active: false };
    this.resetBrakeGesture();
    this.setStatus('calibrating', 0);
  }

  getInput(): ControlInput {
    if (performance.now() - this.lastSeen > 420) {
      this.resetBrakeGesture();
      return { steering: 0, confidence: 0, active: false };
    }
    return { ...this.input };
  }

  getStatus(): TrackingStatus {
    return this.status;
  }

  togglePreview(): boolean {
    this.previewVisible = !this.previewVisible;
    const shell = this.canvas.closest('.camera-shell');
    shell?.classList.toggle('is-hidden', !this.previewVisible);
    return this.previewVisible;
  }

  stop(): void {
    this.stopped = true;
    this.resetBrakeGesture();
    this.cancelWorkerInitialization?.();
    this.cancelWorkerInitialization = null;
    cancelAnimationFrame(this.raf);
    if (this.videoFrameCallback) this.video.cancelVideoFrameCallback(this.videoFrameCallback);
    this.worker?.terminate();
    this.worker = null;
    this.frameInFlight = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.landmarker?.close();
    this.landmarker = null;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused || this.stopped) return;
    this.paused = paused;
    if (paused) {
      this.resetBrakeGesture();
      cancelAnimationFrame(this.raf);
      if (this.videoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.videoFrameCallback);
        this.videoFrameCallback = 0;
      }
    } else {
      this.lastVideoTime = -1;
      this.scheduleNextFrame();
    }
  }

  private scheduleNextFrame(): void {
    if (this.stopped || this.paused) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.videoFrameCallback = this.video.requestVideoFrameCallback(this.processVideoFrame);
    } else {
      this.raf = requestAnimationFrame(this.processAnimationFrame);
    }
  }

  private processVideoFrame = (now: DOMHighResTimeStamp): void => {
    this.processFrame(now);
    this.drawPreview(now);
    this.scheduleNextFrame();
  };

  private processAnimationFrame = (now: DOMHighResTimeStamp): void => {
    this.processFrame(now);
    this.drawPreview(now);
    this.scheduleNextFrame();
  };

  private processFrame(now: DOMHighResTimeStamp): void {
    if (
      this.stopped ||
      this.paused ||
      this.video.readyState < 2 ||
      this.video.currentTime === this.lastVideoTime ||
      now - this.lastInferenceTime < INFERENCE_INTERVAL_MS
    )
      return;
    this.lastVideoTime = this.video.currentTime;
    this.lastInferenceTime = now;

    if (this.worker) {
      if (this.frameInFlight) return;
      this.frameInFlight = true;
      void createImageBitmap(this.video)
        .then((frame) => {
          if (this.stopped || !this.worker) {
            frame.close();
            this.frameInFlight = false;
            return;
          }
          const message: HandWorkerInput = { type: 'frame', frame, timestamp: now };
          this.worker.postMessage(message, [frame]);
        })
        .catch((error) => {
          this.frameInFlight = false;
          void this.activateMainThreadFallback(error);
        });
      return;
    }

    if (this.landmarker) {
      const result = this.serializeResult(this.landmarker.detectForVideo(this.video, now));
      this.consumeResult(result);
      this.updateWheelTarget(result);
    }
  }

  private handleWorkerMessage = (event: MessageEvent<HandWorkerOutput>): void => {
    if (event.data.type === 'result') {
      this.frameInFlight = false;
      this.consumeResult(event.data.result);
      this.updateWheelTarget(event.data.result);
    } else if (event.data.type === 'error') {
      this.frameInFlight = false;
      void this.activateMainThreadFallback(new Error(event.data.message));
    }
  };

  private async activateMainThreadFallback(reason: unknown): Promise<void> {
    if (this.switchingToFallback || this.stopped || this.landmarker) return;
    this.switchingToFallback = true;
    console.warn('Switching hand tracking to the main-thread fallback.', reason);
    this.worker?.terminate();
    this.worker = null;
    this.frameInFlight = false;
    try {
      const wasmRoot = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href)
        .href;
      const localModel = new URL(
        `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`,
        window.location.href,
      ).href;
      await this.initializeMainThreadLandmarker(wasmRoot, localModel);
    } catch (error) {
      console.warn('Main-thread hand tracking fallback failed.', error);
      this.input.active = false;
      this.setStatus('error');
    } finally {
      this.switchingToFallback = false;
    }
  }

  private serializeResult(result: HandLandmarkerResult): HandTrackingResult {
    return {
      landmarks: result.landmarks.map((hand) =>
        hand.map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
        })),
      ),
      handednessScores: result.handedness.map((categories) => categories[0]?.score ?? 0.7),
    };
  }

  private consumeResult(result: HandTrackingResult): void {
    this.wheelGrip = false;
    if (result.landmarks.length !== 2) {
      this.resetBrakeGesture();
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const hands = result.landmarks
      .map((landmarks, index) => ({
        landmarks,
        wrist: landmarks[0],
        closed: isClosedHand(landmarks),
        openPalm: isOpenPalm(landmarks),
        thumbUp: isThumbUp(landmarks),
        score: result.handednessScores[index] ?? 0.7,
      }))
      .sort((a, b) => a.wrist.x - b.wrist.x);

    const separation = Math.hypot(
      hands[1].wrist.x - hands[0].wrist.x,
      hands[1].wrist.y - hands[0].wrist.y,
    );
    const fistsClosed = hands.every((hand) => hand.closed);
    const palmsOpen = hands.every((hand) => hand.openPalm);
    if ((!fistsClosed && !palmsOpen) || separation < 0.14) {
      this.resetBrakeGesture();
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const angle = Math.atan2(
      hands[1].wrist.y - hands[0].wrist.y,
      hands[1].wrist.x - hands[0].wrist.x,
    );
    const confidence = Math.min(hands[0].score, hands[1].score);
    this.lastSeen = performance.now();
    this.wheelGrip = true;

    if (this.status === 'calibrating') {
      this.resetBrakeGesture();
      if (!fistsClosed) {
        this.input.active = false;
        return;
      }
      this.calibrationAngles.push(angle);
      const progress = this.calibrationAngles.length / CALIBRATION_SAMPLES;
      this.onStatus('calibrating', progress);
      if (this.calibrationAngles.length >= CALIBRATION_SAMPLES) {
        this.neutralAngle = this.circularAverage(this.calibrationAngles);
        this.setStatus('tracking');
      }
      return;
    }

    const raw = -steeringFromHands(hands[0].wrist, hands[1].wrist, this.neutralAngle);
    // Two explicit gestures keep braking predictable: thumbs-up is a fixed
    // half brake, while showing both open palms requests a complete stop.
    const rawBrakePressure = palmsOpen ? 1 : hands.every((hand) => hand.thumbUp) ? 0.5 : 0;
    const braking = this.brakeGesture.update(rawBrakePressure > 0, this.lastSeen);
    this.input = {
      steering: damp(this.input.steering, raw, 13, 1 / 30),
      confidence,
      active: true,
      braking: braking ? true : undefined,
      brakePressure: braking ? rawBrakePressure : undefined,
      reverseGear: HAND_REVERSE,
    };
    if (this.status !== 'tracking') this.setStatus('tracking');
  }

  private resetBrakeGesture(): void {
    this.brakeGesture.reset();
  }

  private circularAverage(values: number[]): number {
    const sin = values.reduce((sum, angle) => sum + Math.sin(angle), 0);
    const cos = values.reduce((sum, angle) => sum + Math.cos(angle), 0);
    return Math.atan2(sin, cos);
  }

  /** Records where the virtual wheel should sit, from the latest two-hand result. */
  private updateWheelTarget(result: HandTrackingResult): void {
    const pose = wheelPoseFromHands(
      result.landmarks,
      this.video.videoWidth || 320,
      this.video.videoHeight || 240,
    );
    if (!pose) return;
    this.wheelTarget = pose;
    this.lastWheelSeen = performance.now();
  }

  /** Draws the virtual yoke held between the player's fists. */
  private drawPreview(now: number): void {
    const shell = this.canvas.closest('.camera-shell');
    if (
      !this.previewVisible ||
      shell?.classList.contains('is-hidden') ||
      now - this.lastPreviewTime < PREVIEW_INTERVAL_MS
    )
      return;
    const dt = Math.min(0.1, (now - this.lastPreviewTime) / 1000);
    this.lastPreviewTime = now;

    const width = this.video.videoWidth || 320;
    const height = this.video.videoHeight || 240;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.wheelPose = null;
    }
    this.previewContext ??= this.canvas.getContext('2d');
    const context = this.previewContext;
    if (!context) return;

    const sinceSeen = now - this.lastWheelSeen;
    const target =
      this.wheelTarget && sinceSeen < WHEEL_RETURN_MS
        ? this.wheelTarget
        : defaultWheelPose(width, height);
    this.wheelPose = this.wheelPose ? smoothWheelPose(this.wheelPose, target, dt) : { ...target };
    const gripping = this.wheelGrip && sinceSeen < 300;
    this.wheelAlpha = damp(this.wheelAlpha, gripping ? 1 : 0.38, 8, dt);
    const brakePressure = gripping ? (this.input.brakePressure ?? 0) : 0;
    let state: WheelState = 'idle';
    if (this.status === 'calibrating') state = 'calibrating';
    else if (gripping) state = brakePressure > 0 ? 'braking' : 'gripping';

    context.clearRect(0, 0, width, height);
    context.save();
    // Landmarks are in camera space; mirror to match the selfie-view video.
    context.translate(width, 0);
    context.scale(-1, 1);
    drawSteeringWheel(context, this.wheelPose, {
      state,
      alpha: this.wheelAlpha,
      calibration:
        this.status === 'calibrating' ? this.calibrationAngles.length / CALIBRATION_SAMPLES : 0,
      brakePressure,
      mirrored: true,
    });
    context.restore();
  }

  private setStatus(status: TrackingStatus, progress?: number): void {
    this.status = status;
    this.onStatus(status, progress);
  }
}
