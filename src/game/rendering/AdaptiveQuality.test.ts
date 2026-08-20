import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, chooseInitialQuality } from './AdaptiveQuality';

const recordWindow = (quality: AdaptiveQuality, frameSeconds: number) => {
  let changed = null;
  for (let index = 0; index < 120; index += 1) {
    changed = quality.recordFrame(frameSeconds) ?? changed;
  }
  return changed;
};

describe('adaptive render quality', () => {
  it('chooses conservative tiers from device capabilities', () => {
    expect(chooseInitialQuality(2, 2)).toBe('low');
    expect(chooseInitialQuality(4, 4)).toBe('medium');
    expect(chooseInitialQuality(8, 8)).toBe('high');
  });

  it('downgrades after one consistently slow window', () => {
    const quality = new AdaptiveQuality('high');
    expect(recordWindow(quality, 0.026)?.level).toBe('medium');
  });

  it('requires three healthy windows before upgrading', () => {
    const quality = new AdaptiveQuality('low');
    expect(recordWindow(quality, 0.016)).toBeNull();
    expect(recordWindow(quality, 0.016)).toBeNull();
    expect(recordWindow(quality, 0.016)?.level).toBe('medium');
  });

  it('supports a fixed quality selection and clears adaptive history', () => {
    const quality = new AdaptiveQuality('high');
    for (let index = 0; index < 100; index += 1) quality.recordFrame(0.03);

    expect(quality.setLevel('low')).toMatchObject({
      level: 'low',
      pixelRatioCap: 1,
      shadowMapSize: 512,
    });
    expect(recordWindow(quality, 0.016)).toBeNull();
  });
});
