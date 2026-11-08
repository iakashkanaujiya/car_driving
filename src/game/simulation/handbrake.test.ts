import { describe, expect, it } from 'vitest';
import { fromKph, GAME, KEYBOARD_REVERSE } from '../config';
import {
  followTravelHeading,
  HANDBRAKE_YAW_BOOST,
  MAX_SLIDE_ANGLE,
  steeringYawRate,
} from '../math';
import type { ControlInput } from '../types';
import { cruiseIsDriving, cruiseStaysEngaged } from './cruiseControl';
import { createSpeedPlan, updateReverseHold } from './drivingAssist';

const keyboard = (overrides: Partial<ControlInput> = {}): ControlInput => ({
  steering: 0,
  confidence: 1,
  active: true,
  accelerating: false,
  braking: false,
  reverseGear: KEYBOARD_REVERSE,
  brakeCancelsCruise: true,
  ...overrides,
});
const hands = (overrides: Partial<ControlInput> = {}): ControlInput => ({
  steering: 0,
  confidence: 1,
  active: true,
  ...overrides,
});

describe('handbrake', () => {
  it('stops the car more gently than the footbrake, even on the accelerator', () => {
    const plan = createSpeedPlan(keyboard({ handbrake: true, accelerating: true }), fromKph(90));
    expect(plan.targetSpeed).toBe(0);
    expect(plan.acceleration).toBe(GAME.handbrake);
    expect(GAME.handbrake).toBeLessThan(GAME.serviceBrake);
    expect(plan.assistMessage).toBe('HANDBRAKE');
    // Only the footbrake lights the brake lamps.
    expect(plan.braking).toBe(false);
  });

  it('brakes at full strength with the footbrake pressed too', () => {
    const plan = createSpeedPlan(keyboard({ handbrake: true, braking: true }), fromKph(90));
    expect(plan.acceleration).toBe(GAME.serviceBrake);
    expect(plan.braking).toBe(true);
  });

  it('stops a reversing car and never engages reverse', () => {
    const reversing = createSpeedPlan(keyboard({ handbrake: true, braking: true }), -fromKph(10), {
      reverseHoldSeconds: 5,
    });
    expect(reversing.targetSpeed).toBe(0);
    expect(updateReverseHold(2, keyboard({ handbrake: true, braking: true }), 0, 0.1)).toBe(0);
  });

  it('works with hand controls and takes over from adaptive cruise', () => {
    const plan = createSpeedPlan(hands({ handbrake: true }), fromKph(100), { cruiseKph: 100 });
    expect(plan.targetSpeed).toBe(0);
    expect(plan.cruiseStatus).toBeUndefined();
    // Pulling it switches cruise off in either mode.
    expect(cruiseStaysEngaged(hands({ handbrake: true }))).toBe(false);
    expect(cruiseStaysEngaged(keyboard({ handbrake: true }))).toBe(false);
    expect(cruiseIsDriving(hands({ handbrake: true }))).toBe(false);
  });

  it('does nothing while hand tracking is lost', () => {
    const plan = createSpeedPlan(hands({ active: false, handbrake: true }), fromKph(50));
    expect(plan.assistMessage).not.toBe('HANDBRAKE');
    expect(plan.autoBraking).toBe(true);
  });
});

describe('handbrake slide', () => {
  it('lets the nose swing round faster than the tyres alone allow', () => {
    const speed = fromKph(70);
    const gripping = steeringYawRate(1, speed);
    expect(gripping * HANDBRAKE_YAW_BOOST).toBeGreaterThan(gripping);
  });

  it('lags the travel direction behind the nose while sliding, up to a limit', () => {
    let travel = 0;
    let nose = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      nose += 0.03;
      travel = followTravelHeading(travel, nose, true, 1 / 60);
    }
    const slide = nose - travel;
    expect(slide).toBeGreaterThan(0.3);
    expect(slide).toBeLessThanOrEqual(MAX_SLIDE_ANGLE + 1e-9);
  });

  it('catches the travel direction up with the nose once grip returns', () => {
    let travel = 0;
    const nose = 0.5;
    for (let frame = 0; frame < 60; frame += 1) {
      travel = followTravelHeading(travel, nose, false, 1 / 60);
    }
    expect(nose - travel).toBeLessThan(0.01);
  });

  it('measures the slide the short way round', () => {
    // Just either side of ±π is a small angle, not a near full turn.
    const travel = followTravelHeading(Math.PI - 0.05, -Math.PI + 0.05, true, 1 / 60);
    const slip = Math.atan2(Math.sin(-Math.PI + 0.05 - travel), Math.cos(-Math.PI + 0.05 - travel));
    expect(Math.abs(slip)).toBeLessThan(0.11);
  });
});
