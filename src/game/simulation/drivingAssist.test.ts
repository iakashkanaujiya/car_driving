import { describe, expect, it } from 'vitest';
import { GAME, laneOffsets } from '../config';
import { createSpeedPlan, scanTraffic } from './drivingAssist';

describe('driving assistance', () => {
  it('slows for a same-direction lead car', () => {
    const threat = scanTraffic(
      [{ distance: 30, lane: 0, laneOffset: 0, speed: 20, direction: 1 }],
      0,
      laneOffsets[0],
      GAME.maxSpeed,
    );

    expect(threat.targetSpeed).toBeLessThan(20);
    expect(threat.leadDistance).toBe(30);
    expect(threat.leadIsIncoming).toBe(false);
  });

  it('ignores cars outside the player lane', () => {
    const threat = scanTraffic(
      [{ distance: 20, lane: 1, laneOffset: 0, speed: 5, direction: -1 }],
      0,
      laneOffsets[0],
      GAME.maxSpeed,
    );

    expect(threat.targetSpeed).toBe(GAME.maxSpeed);
    expect(threat.leadDistance).toBe(Number.POSITIVE_INFINITY);
  });

  it('auto-brakes when hand controls become inactive', () => {
    const plan = createSpeedPlan({ steering: 0, confidence: 0, active: false }, 20, GAME.maxSpeed, {
      targetSpeed: GAME.maxSpeed,
      leadDistance: Infinity,
      leadIsIncoming: false,
    });

    expect(plan.targetSpeed).toBe(0);
    expect(plan.assistMessage).toBe('HANDS LOST · AUTO BRAKE');
  });

  it('uses emergency braking for close oncoming traffic', () => {
    const plan = createSpeedPlan({ steering: 0, confidence: 1, active: true }, 25, GAME.maxSpeed, {
      targetSpeed: 5,
      leadDistance: 20,
      leadIsIncoming: true,
    });

    expect(plan.acceleration).toBe(GAME.emergencyBrake);
    expect(plan.assistMessage).toBe('ONCOMING · EMERGENCY BRAKE');
  });
});
