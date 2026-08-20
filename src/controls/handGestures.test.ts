import { describe, expect, it } from 'vitest';
import { isClosedHand, isOpenPalm, isThumbUp, SustainedGesture } from './handGestures';
import type { HandPoint } from './handWorkerTypes';

function createFist(thumb: 'up' | 'low' | 'folded' | 'sideways' | 'bent'): HandPoint[] {
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
  } else if (thumb === 'low') {
    points[2] = { x: 0.4, y: 0.66, z: 0 };
    points[3] = { x: 0.4, y: 0.61, z: 0 };
    points[4] = { x: 0.4, y: 0.56, z: 0 };
  } else if (thumb === 'sideways') {
    points[2] = { x: 0.4, y: 0.64, z: 0 };
    points[3] = { x: 0.3, y: 0.58, z: 0 };
    points[4] = { x: 0.18, y: 0.58, z: 0 };
  } else if (thumb === 'bent') {
    // A raised tip alone is not a thumb-up gesture when the middle joint is folded down.
    points[2] = { x: 0.4, y: 0.66, z: 0 };
    points[3] = { x: 0.4, y: 0.7, z: 0 };
    points[4] = { x: 0.4, y: 0.42, z: 0 };
  } else {
    points[2] = { x: 0.42, y: 0.66, z: 0 };
    points[3] = { x: 0.44, y: 0.64, z: 0 };
    points[4] = { x: 0.48, y: 0.65, z: 0 };
  }

  return points;
}

function createOpenPalm(): HandPoint[] {
  const points = createFist('folded');
  points[8] = { x: 0.35, y: 0.28, z: 0 };
  points[12] = { x: 0.46, y: 0.18, z: 0 };
  points[16] = { x: 0.57, y: 0.22, z: 0 };
  points[20] = { x: 0.7, y: 0.32, z: 0 };
  return points;
}

function rotateHand(landmarks: HandPoint[], radians: number): HandPoint[] {
  const wrist = landmarks[0];
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return landmarks.map((point) => {
    const x = point.x - wrist.x;
    const y = point.y - wrist.y;
    return {
      x: wrist.x + x * cos - y * sin,
      y: wrist.y + x * sin + y * cos,
      z: point.z,
    };
  });
}

describe('hand gestures', () => {
  it('recognizes a fist with its thumb pointing upward', () => {
    const landmarks = createFist('up');
    expect(isClosedHand(landmarks)).toBe(true);
    expect(isThumbUp(landmarks)).toBe(true);
  });

  it('recognizes an open palm separately from a closed steering grip', () => {
    const landmarks = createOpenPalm();
    expect(isOpenPalm(landmarks)).toBe(true);
    expect(isClosedHand(landmarks)).toBe(false);
  });

  it('keeps thumb and palm gestures unchanged while the hand rotates to steer', () => {
    for (const angle of [-Math.PI / 3, Math.PI / 3]) {
      expect(isThumbUp(rotateHand(createFist('up'), angle))).toBe(true);
      expect(isThumbUp(rotateHand(createFist('low'), angle))).toBe(false);
      expect(isOpenPalm(rotateHand(createOpenPalm(), angle))).toBe(true);
    }
  });

  it('rejects low, folded, sideways, and bent thumbs', () => {
    expect(isThumbUp(createFist('low'))).toBe(false);
    expect(isThumbUp(createFist('folded'))).toBe(false);
    expect(isThumbUp(createFist('sideways'))).toBe(false);
    expect(isThumbUp(createFist('bent'))).toBe(false);
    expect(isThumbUp(createOpenPalm())).toBe(false);
  });

  it('requires a gesture to remain stable for its hold duration', () => {
    const gesture = new SustainedGesture(180);
    expect(gesture.update(true, 1_000)).toBe(false);
    expect(gesture.update(true, 1_179)).toBe(false);
    expect(gesture.update(true, 1_180)).toBe(true);
  });

  it('releases immediately and restarts the hold after detection is lost', () => {
    const gesture = new SustainedGesture(180);
    expect(gesture.update(true, 1_000)).toBe(false);
    expect(gesture.update(true, 1_180)).toBe(true);
    expect(gesture.update(false, 1_181)).toBe(false);
    expect(gesture.update(true, 1_200)).toBe(false);
  });
});
