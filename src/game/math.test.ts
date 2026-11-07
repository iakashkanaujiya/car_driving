import { describe, expect, it } from 'vitest';
import { GAME, laneDividerOffsets, laneOffsets, TRAFFIC_COUNT_OPTIONS } from './config';
import {
  clamp,
  constrainToRoad,
  MIN_TURN_RADIUS,
  roadWindowStart,
  steeringFromHands,
  steeringYawRate,
  wrapIntoWindow,
} from './math';

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

describe('road window', () => {
  it('keeps most of the window ahead of the view, whichever way it faces', () => {
    expect(roadWindowStart(500, 1, 400, 60)).toBe(440);
    // Turned around: the same 60 units sit behind the view, now at higher distances.
    expect(roadWindowStart(500, -1, 400, 60)).toBe(500 - 340);
    // Side-on, the window is centred on the player.
    expect(roadWindowStart(500, 0, 400, 60)).toBe(300);
    expect(roadWindowStart(500, 3, 400, 60)).toBe(440);
  });

  it('wraps slots by whole rings so recycled scenery keeps its layout', () => {
    expect(wrapIntoWindow(120, 100, 50)).toBe(120);
    expect(wrapIntoWindow(20, 100, 50)).toBe(120);
    expect(wrapIntoWindow(270, 100, 50)).toBe(120);
    expect(wrapIntoWindow(-30, -100, 50)).toBe(-80);
    expect(wrapIntoWindow(150, 100, 50)).toBe(100);
  });
});

describe('steering yaw', () => {
  it('only turns the wheels when the car is stopped', () => {
    expect(steeringYawRate(1, 0)).toBe(0);
    expect(steeringYawRate(-1, 0)).toBe(-0);
  });

  it('never turns tighter than a real turning circle at low speed', () => {
    for (const speed of [0.5, 2, 5, 8]) {
      expect(Math.abs(steeringYawRate(1, speed))).toBeLessThanOrEqual(
        speed / MIN_TURN_RADIUS + 1e-9,
      );
    }
  });

  it('keeps the established feel at driving speeds', () => {
    // Above the low-speed limit the original speed-scaled authority applies.
    expect(steeringYawRate(1, 10)).toBeCloseTo(0.82 * (0.28 + 0.72 * (10 / 18)), 9);
    expect(steeringYawRate(1, 30)).toBeCloseTo(0.82, 9);
  });

  it('swings the nose the other way in reverse', () => {
    expect(steeringYawRate(1, -4)).toBeCloseTo(-steeringYawRate(1, 4), 9);
  });
});
