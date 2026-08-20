import type { QualityLevel } from '../game/rendering/AdaptiveQuality';

export interface RenderCounters {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface PerformanceSnapshot extends RenderCounters {
  fps: number;
  averageFrameMs: number;
  p90FrameMs: number;
  quality: QualityLevel;
}

const REPORT_INTERVAL_SECONDS = 0.5;

/** Aggregates frame pacing without allocating or updating the DOM every frame. */
export class PerformanceMonitor {
  private readonly frameTimes: number[] = [];
  private elapsedSeconds = 0;

  reset(): void {
    this.frameTimes.length = 0;
    this.elapsedSeconds = 0;
  }

  recordFrame(
    frameSeconds: number,
    counters: RenderCounters,
    quality: QualityLevel,
  ): PerformanceSnapshot | null {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 1) return null;

    this.frameTimes.push(frameSeconds);
    this.elapsedSeconds += frameSeconds;
    if (this.elapsedSeconds < REPORT_INTERVAL_SECONDS) return null;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const frameCount = this.frameTimes.length;
    const snapshot: PerformanceSnapshot = {
      fps: frameCount / this.elapsedSeconds,
      averageFrameMs: (this.elapsedSeconds * 1000) / frameCount,
      p90FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] * 1000,
      quality,
      ...counters,
    };
    this.reset();
    return snapshot;
  }
}
