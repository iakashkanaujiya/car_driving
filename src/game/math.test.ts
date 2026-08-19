import { describe, expect, it } from 'vitest';
import { GAME, laneOffsets, TRAFFIC_COUNT_OPTIONS } from './config';
import { clamp, constrainToRoad, curveSpeedLimit, steeringFromHands } from './math';

describe('driving math', () => {
  it('clamps values to the requested range', () => {
    expect(clamp(4, -1, 1)).toBe(1);
    expect(clamp(-2, -1, 1)).toBe(-1);
  });

  it('maps a two-hand rotation into normalized steering', () => {
    const neutral = steeringFromHands({ x: 0, y: 0 }, { x: 1, y: 0 }, 0);
    const turned = steeringFromHands({ x: 0, y: 0 }, { x: 1, y: 0.35 }, 0);
    expect(neutral).toBe(0);
    expect(turned).toBeGreaterThan(0.5);
  });

  it('reaches full steering with about 35 degrees of hand rotation', () => {
    const fullTurn = steeringFromHands({ x: 0, y: 0 }, { x: 1, y: 0.7 }, 0);
    expect(fullTurn).toBe(1);
  });

  it('reduces target speed for upcoming curvature', () => {
    const speed = curveSpeedLimit(0, 45, 18);
    expect(speed).toBeGreaterThanOrEqual(18);
    expect(speed).toBeLessThanOrEqual(45);
  });

  it('keeps exactly two traffic lanes inside the road edges', () => {
    expect(laneOffsets).toHaveLength(2);
    for (const offset of laneOffsets) {
      expect(Math.abs(offset) + GAME.collisionWidth / 2).toBeLessThan(GAME.roadWidth / 2);
    }
  });

  it('allows the game to run without traffic', () => {
    expect(TRAFFIC_COUNT_OPTIONS).toEqual([0, 4, 8, 12, 16]);
  });

  it('keeps the complete vehicle body inside the road boundaries', () => {
    const result = constrainToRoad(20, 0, 0, 20, 1.25);
    expect(result.lateral).toBe(8.75);
    expect(result.worldX).toBe(8.75);
    expect(result.boundary).toBe(1);
  });
});
