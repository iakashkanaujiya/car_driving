import { describe, expect, it } from 'vitest';
import { GAME, laneDividerOffsets, laneOffsets, TRAFFIC_COUNT_OPTIONS } from './config';
import { clamp, constrainToRoad, steeringFromHands } from './math';

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

  it('has four lanes, two each way, inside the road edges', () => {
    expect(laneOffsets).toHaveLength(4);
    expect(laneOffsets.slice(0, 2).every((offset) => offset < 0)).toBe(true);
    expect(laneOffsets.slice(2).every((offset) => offset > 0)).toBe(true);
    const widest = GAME.conceptCollisionWidth / 2 + GAME.trafficLaneJitter;
    for (const offset of laneOffsets) {
      expect(Math.abs(offset) + widest).toBeLessThan(GAME.roadWidth / 2);
      // Traffic always stays clear of the double yellow centre line.
      expect(Math.abs(offset) - widest).toBeGreaterThan(GAME.centerLineHalfWidth);
    }
    for (const divider of laneDividerOffsets) {
      expect(Math.abs(divider)).toBeCloseTo(GAME.centerLineHalfWidth + GAME.laneWidth);
    }
  });

  it('leaves room for cars side by side in neighbouring lanes', () => {
    for (let lane = 1; lane < laneOffsets.length; lane += 1) {
      const spacing = laneOffsets[lane] - laneOffsets[lane - 1];
      expect(spacing - GAME.trafficLaneJitter * 2).toBeGreaterThan(GAME.conceptCollisionWidth);
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
