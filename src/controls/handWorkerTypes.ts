export interface HandPoint {
  x: number;
  y: number;
  z: number;
}

export interface HandTrackingResult {
  landmarks: HandPoint[][];
  handednessScores: number[];
}

export type HandWorkerInput =
  | {
      type: 'init';
      wasmRoot: string;
      modelAssetPath: string;
    }
  | {
      type: 'frame';
      frame: ImageBitmap;
      timestamp: number;
    };

export type HandWorkerOutput =
  | { type: 'ready' }
  | { type: 'result'; result: HandTrackingResult }
  | { type: 'error'; message: string };
