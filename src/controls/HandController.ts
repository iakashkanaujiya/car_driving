import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { damp, steeringFromHands } from '../game/math';
import type { ControlInput } from '../game/types';
import type { HandPoint, HandTrackingResult, HandWorkerInput, HandWorkerOutput } from './handWorkerTypes';

type TrackingStatus = 'idle' | 'loading' | 'ready' | 'calibrating' | 'tracking' | 'lost' | 'error';
const INFERENCE_INTERVAL_MS = 1000 / 24;

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
  private status: TrackingStatus = 'idle';
  private lastSeen = 0;
  private previewVisible = true;
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
        video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (this.stopped) return;

      const wasmRoot = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href).href;
      const localModel = new URL(`${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`, window.location.href).href;
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

    const worker = new Worker(new URL('./handTracking.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Hand tracking worker initialization timed out.')), 20_000);
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
    }).catch((error) => {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      throw error;
    }).finally(() => {
      this.cancelWorkerInitialization = null;
    });

    worker.onmessage = this.handleWorkerMessage;
    worker.onerror = (event): void => {
      void this.activateMainThreadFallback(new Error(event.message || 'Hand tracking worker stopped.'));
    };
  }

  private async initializeMainThreadLandmarker(wasmRoot: string, localModel: string): Promise<void> {
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
    this.setStatus('calibrating', 0);
  }

  getInput(): ControlInput {
    if (performance.now() - this.lastSeen > 420) return { steering: 0, confidence: 0, active: false };
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

  private scheduleNextFrame(): void {
    if (this.stopped) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.videoFrameCallback = this.video.requestVideoFrameCallback(this.processVideoFrame);
    } else {
      this.raf = requestAnimationFrame(this.processAnimationFrame);
    }
  }

  private processVideoFrame = (now: DOMHighResTimeStamp): void => {
    this.processFrame(now);
    this.scheduleNextFrame();
  };

  private processAnimationFrame = (now: DOMHighResTimeStamp): void => {
    this.processFrame(now);
    this.scheduleNextFrame();
  };

  private processFrame(now: DOMHighResTimeStamp): void {
    if (
      this.stopped ||
      this.video.readyState < 2 ||
      this.video.currentTime === this.lastVideoTime ||
      now - this.lastInferenceTime < INFERENCE_INTERVAL_MS
    ) return;
    this.lastVideoTime = this.video.currentTime;
    this.lastInferenceTime = now;

    if (this.worker) {
      if (this.frameInFlight) return;
      this.frameInFlight = true;
      void createImageBitmap(this.video).then((frame) => {
        if (this.stopped || !this.worker) {
          frame.close();
          this.frameInFlight = false;
          return;
        }
        const message: HandWorkerInput = { type: 'frame', frame, timestamp: now };
        this.worker.postMessage(message, [frame]);
      }).catch((error) => {
        this.frameInFlight = false;
        void this.activateMainThreadFallback(error);
      });
      return;
    }

    if (this.landmarker) {
      const result = this.serializeResult(this.landmarker.detectForVideo(this.video, now));
      this.consumeResult(result);
      this.drawPreview(result);
    }
  }

  private handleWorkerMessage = (event: MessageEvent<HandWorkerOutput>): void => {
    if (event.data.type === 'result') {
      this.frameInFlight = false;
      this.consumeResult(event.data.result);
      this.drawPreview(event.data.result);
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
      const wasmRoot = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href).href;
      const localModel = new URL(`${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`, window.location.href).href;
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
      landmarks: result.landmarks.map((hand) => hand.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      }))),
      handednessScores: result.handedness.map((categories) => categories[0]?.score ?? 0.7),
    };
  };

  private consumeResult(result: HandTrackingResult): void {
    if (result.landmarks.length !== 2) {
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const hands = result.landmarks
      .map((landmarks, index) => ({
        landmarks,
        wrist: landmarks[0],
        closed: this.isClosedHand(landmarks),
        score: result.handednessScores[index] ?? 0.7,
      }))
      .sort((a, b) => a.wrist.x - b.wrist.x);

    const separation = Math.hypot(hands[1].wrist.x - hands[0].wrist.x, hands[1].wrist.y - hands[0].wrist.y);
    if (!hands.every((hand) => hand.closed) || separation < 0.14) {
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const angle = Math.atan2(hands[1].wrist.y - hands[0].wrist.y, hands[1].wrist.x - hands[0].wrist.x);
    const confidence = Math.min(hands[0].score, hands[1].score);
    this.lastSeen = performance.now();

    if (this.status === 'calibrating') {
      this.calibrationAngles.push(angle);
      const progress = this.calibrationAngles.length / 45;
      this.onStatus('calibrating', progress);
      if (this.calibrationAngles.length >= 45) {
        this.neutralAngle = this.circularAverage(this.calibrationAngles);
        this.setStatus('tracking');
      }
      return;
    }

    const raw = -steeringFromHands(hands[0].wrist, hands[1].wrist, this.neutralAngle);
    this.input = {
      steering: damp(this.input.steering, raw, 13, 1 / 30),
      confidence,
      active: true,
    };
    if (this.status !== 'tracking') this.setStatus('tracking');
  }

  private isClosedHand(landmarks: HandPoint[]): boolean {
    const wrist = landmarks[0];
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    let folded = 0;
    for (let index = 0; index < tips.length; index += 1) {
      const tipDistance = Math.hypot(landmarks[tips[index]].x - wrist.x, landmarks[tips[index]].y - wrist.y);
      const mcpDistance = Math.hypot(landmarks[mcps[index]].x - wrist.x, landmarks[mcps[index]].y - wrist.y);
      if (tipDistance < mcpDistance * 1.58) folded += 1;
    }
    return folded >= 3;
  }

  private circularAverage(values: number[]): number {
    const sin = values.reduce((sum, angle) => sum + Math.sin(angle), 0);
    const cos = values.reduce((sum, angle) => sum + Math.cos(angle), 0);
    return Math.atan2(sin, cos);
  }

  private drawPreview(result: HandTrackingResult): void {
    const width = this.video.videoWidth || 480;
    const height = this.video.videoHeight || 360;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    for (const hand of result.landmarks) {
      context.strokeStyle = 'rgba(93, 255, 190, 0.85)';
      context.fillStyle = '#ecff76';
      context.lineWidth = 3;
      for (const connection of HandLandmarker.HAND_CONNECTIONS) {
        const a = connection.start;
        const b = connection.end;
        context.beginPath();
        context.moveTo(hand[a].x * width, hand[a].y * height);
        context.lineTo(hand[b].x * width, hand[b].y * height);
        context.stroke();
      }
      for (const point of hand) {
        context.beginPath();
        context.arc(point.x * width, point.y * height, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  private setStatus(status: TrackingStatus, progress?: number): void {
    this.status = status;
    this.onStatus(status, progress);
  }
}
