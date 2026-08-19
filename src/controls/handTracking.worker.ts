import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandTrackingResult, HandWorkerInput, HandWorkerOutput } from './handWorkerTypes';

interface WorkerScope {
  onmessage: ((event: MessageEvent<HandWorkerInput>) => void) | null;
  postMessage(message: HandWorkerOutput): void;
}

const workerScope = globalThis as unknown as WorkerScope;
let landmarker: HandLandmarker | null = null;

const send = (message: HandWorkerOutput): void => workerScope.postMessage(message);

const serializeResult = (
  result: ReturnType<HandLandmarker['detectForVideo']>,
): HandTrackingResult => ({
  landmarks: result.landmarks.map((hand) =>
    hand.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    })),
  ),
  handednessScores: result.handedness.map((categories) => categories[0]?.score ?? 0.7),
});

workerScope.onmessage = (event): void => {
  const message = event.data;
  if (message.type === 'init') {
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(message.wasmRoot, true);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: message.modelAssetPath, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        send({ type: 'ready' });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return;
  }

  if (!landmarker) {
    message.frame.close();
    send({ type: 'error', message: 'Hand tracker received a frame before initialization.' });
    return;
  }

  try {
    const result = landmarker.detectForVideo(message.frame, message.timestamp);
    send({ type: 'result', result: serializeResult(result) });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    message.frame.close();
  }
};
