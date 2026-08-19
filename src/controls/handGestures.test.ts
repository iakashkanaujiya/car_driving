import { describe, expect, it } from 'vitest';
import { isClosedHand, isThumbUp } from './handGestures';
import type { HandPoint } from './handWorkerTypes';

function createFist(thumb: 'up' | 'folded' | 'sideways'): HandPoint[] {
  const points = Array.from({ length: 21 }, (): HandPoint => ({ x: 0.5, y: 0.68, z: 0 }));
  points[0] = { x: 0.5, y: 0.8, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[9] = { x: 0.48, y: 0.58, z: 0 };
  points[13] = { x: 0.54, y: 0.6, z: 0 };
  points[17] = { x: 0.6, y: 0.64, z: 0 };

  if (thumb === 'up') {
    points[2] = { x: 0.4, y: 0.66, z: 0 };
    points[3] = { x: 0.4, y: 0.46, z: 0 };
    points[4] = { x: 0.4, y: 0.28, z: 0 };
  } else if (thumb === 'sideways') {
    points[2] = { x: 0.4, y: 0.64, z: 0 };
    points[3] = { x: 0.3, y: 0.58, z: 0 };
    points[4] = { x: 0.18, y: 0.58, z: 0 };
  } else {
    points[2] = { x: 0.42, y: 0.66, z: 0 };
    points[3] = { x: 0.44, y: 0.64, z: 0 };
    points[4] = { x: 0.48, y: 0.65, z: 0 };
  }

  return points;
}

describe('hand gestures', () => {
  it('recognizes a fist with its thumb pointing upward', () => {
    const landmarks = createFist('up');
    expect(isClosedHand(landmarks)).toBe(true);
    expect(isThumbUp(landmarks)).toBe(true);
  });

  it('rejects folded and sideways thumbs', () => {
    expect(isThumbUp(createFist('folded'))).toBe(false);
    expect(isThumbUp(createFist('sideways'))).toBe(false);
  });
});
