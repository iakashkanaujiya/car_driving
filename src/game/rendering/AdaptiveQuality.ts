export type QualityLevel = 'low' | 'medium' | 'high';

export interface RenderQualitySettings {
  level: QualityLevel;
  pixelRatioCap: number;
  shadowMapSize: number;
}

const QUALITY_LEVELS: readonly RenderQualitySettings[] = [
  { level: 'low', pixelRatioCap: 1, shadowMapSize: 512 },
  { level: 'medium', pixelRatioCap: 1.25, shadowMapSize: 1024 },
  { level: 'high', pixelRatioCap: 1.5, shadowMapSize: 2048 },
];

const SAMPLE_WINDOW = 120;

/** Selects a conservative starting tier from coarse device capabilities. */
export function chooseInitialQuality(
  hardwareConcurrency: number,
  deviceMemoryGb?: number,
): QualityLevel {
  const memory = deviceMemoryGb ?? 4;
  if (hardwareConcurrency >= 8 && memory >= 8) return 'high';
  if (hardwareConcurrency >= 4 && memory >= 4) return 'medium';
  return 'low';
}

/**
 * Adjusts quality from sustained frame pacing. Downgrades happen quickly;
 * upgrades require three healthy windows to avoid visible quality oscillation.
 */
export class AdaptiveQuality {
  private levelIndex: number;
  private readonly samples: number[] = [];
  private healthyWindows = 0;

  constructor(initialLevel: QualityLevel) {
    this.levelIndex = QUALITY_LEVELS.findIndex(({ level }) => level === initialLevel);
  }

  get settings(): RenderQualitySettings {
    return QUALITY_LEVELS[this.levelIndex];
  }

  recordFrame(frameSeconds: number): RenderQualitySettings | null {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.25) return null;
    this.samples.push(frameSeconds);
    if (this.samples.length < SAMPLE_WINDOW) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    this.samples.length = 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    if (p90 > 0.021 && this.levelIndex > 0) {
      this.levelIndex -= 1;
      this.healthyWindows = 0;
      return this.settings;
    }
    if (p90 < 0.018 && this.levelIndex < QUALITY_LEVELS.length - 1) {
      this.healthyWindows += 1;
      if (this.healthyWindows >= 3) {
        this.levelIndex += 1;
        this.healthyWindows = 0;
        return this.settings;
      }
    } else {
      this.healthyWindows = 0;
    }
    return null;
  }
}
