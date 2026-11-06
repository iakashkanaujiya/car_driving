import { describe, expect, it } from 'vitest';
import {
  defaultWheelPose,
  gripPoint,
  smoothWheelPose,
  wheelPoseFromHands,
  yokeOutline,
} from './steeringWheelOverlay';
import type { WheelPoint } from './steeringWheelOverlay';

/** A 21-landmark hand whose palm landmarks all sit at one point. */
const fistAt = (x: number, y: number): WheelPoint[] => Array.from({ length: 21 }, () => ({ x, y }));

describe('virtual steering wheel pose', () => {
  it('runs the rim through both fists regardless of hand order', () => {
    const left = fistAt(0.25, 0.5);
    const right = fistAt(0.75, 0.5);
    const pose = wheelPoseFromHands([right, left], 640, 480)!;

    expect(pose.x).toBeCloseTo(320);
    expect(pose.y).toBeCloseTo(240);
    expect(pose.radius).toBeCloseTo(160);
    expect(pose.angle).toBeCloseTo(0);
    expect(wheelPoseFromHands([left, right], 640, 480)).toEqual(pose);
  });

  it('measures rotation in pixels so wide cameras turn the wheel accurately', () => {
    // Normalized 0.25 x 0.25 offset on a 16:9 frame is not 45 degrees on screen.
    const pose = wheelPoseFromHands([fistAt(0.25, 0.25), fistAt(0.5, 0.5)], 1280, 720)!;
    expect(pose.angle).toBeCloseTo(Math.atan2(180, 320));
  });

  it('grips the centre of the fist rather than the wrist', () => {
    const hand = fistAt(0, 0);
    for (const index of [5, 9, 13, 17]) hand[index] = { x: 0.5, y: 0.5 };
    expect(gripPoint(hand, 100, 100)).toEqual({ x: 40, y: 40 });
  });

  it('needs two complete hands', () => {
    expect(wheelPoseFromHands([fistAt(0.5, 0.5)], 640, 480)).toBeNull();
    expect(
      wheelPoseFromHands([fistAt(0.2, 0.5), fistAt(0.8, 0.5).slice(0, 10)], 640, 480),
    ).toBeNull();
  });

  it('smooths toward the hands and turns through the shorter arc', () => {
    const start = { x: 0, y: 0, radius: 100, angle: Math.PI - 0.05 };
    const target = { x: 100, y: 0, radius: 100, angle: -Math.PI + 0.05 };
    const next = smoothWheelPose(start, target, 1 / 30);

    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    // Crossing +/-PI must not spin the wheel the long way round.
    expect(next.angle).toBeGreaterThan(start.angle);
    expect(next.angle).toBeLessThan(start.angle + 0.1);
    expect(smoothWheelPose(start, target, 10).x).toBeCloseTo(100);
  });

  it('waits for the hands in the middle of the preview', () => {
    const pose = defaultWheelPose(640, 480);
    expect(pose.x).toBe(320);
    expect(pose.angle).toBe(0);
    expect(pose.radius).toBeGreaterThan(100);
  });

  it('draws an open-top yoke whose grips sit in both fists', () => {
    const outline = yokeOutline();
    // Mirror-symmetric: the right half reverses the left half.
    outline.forEach(([x, y], index) => {
      const [mx, my] = outline[outline.length - 1 - index];
      expect(x).toBeCloseTo(-mx);
      expect(y).toBeCloseTo(my);
    });
    // Both vertical grips pass through the fist positions at (+/-1, 0).
    for (const side of [-1, 1]) {
      expect(outline.some(([x, y]) => Math.abs(x - side) < 1e-9 && Math.abs(y) < 0.1)).toBe(true);
    }
    // No rim across the top centre, and a flat bottom below the grips.
    expect(outline.some(([x, y]) => Math.abs(x) < 0.5 && y < 0)).toBe(false);
    const bottom = outline.filter(([x]) => Math.abs(x) < 0.5).map(([, y]) => y);
    expect(Math.min(...bottom)).toBeCloseTo(Math.max(...bottom));
  });
});
