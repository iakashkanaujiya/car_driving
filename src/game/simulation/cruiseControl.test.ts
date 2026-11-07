import { describe, expect, it } from 'vitest';
import { driveAcceleration, fromKph, GAME, laneOffsets } from '../config';
import {
  ACC_RANGE,
  ACC_STANDSTILL_GAP,
  ACC_TIME_GAP,
  adjustCruise,
  CRUISE_DEFAULT_KPH,
  CRUISE_MAX_KPH,
  CRUISE_MIN_KPH,
  cruiseStaysEngaged,
  findLeadVehicle,
  planAdaptiveCruise,
} from './cruiseControl';
import type { RadarTarget } from './cruiseControl';
import { createSpeedPlan } from './drivingAssist';

const kph = fromKph;
const keys = (accelerating: boolean, braking: boolean) => ({
  steering: 0,
  confidence: 1,
  active: true,
  accelerating,
  braking,
  brakeCancelsCruise: true,
});
const hands = { steering: 0, confidence: 1, active: true };
const CAR_LENGTH = 9.2;

describe('adaptive cruise set speed', () => {
  it('starts at 80 km/h', () => {
    expect(CRUISE_DEFAULT_KPH).toBe(80);
  });

  it('steps the set speed to the next multiple of five, within limits', () => {
    expect(adjustCruise(87, 1)).toBe(90);
    expect(adjustCruise(90, 1)).toBe(95);
    expect(adjustCruise(87, -1)).toBe(85);
    expect(adjustCruise(85, -1)).toBe(80);
    expect(adjustCruise(CRUISE_MIN_KPH, -1)).toBe(CRUISE_MIN_KPH);
    expect(adjustCruise(CRUISE_MAX_KPH, 1)).toBe(CRUISE_MAX_KPH);
  });

  it('switches off on a keyboard brake press, like a real pedal', () => {
    expect(cruiseStaysEngaged(keys(false, false))).toBe(true);
    expect(cruiseStaysEngaged(keys(true, false))).toBe(true);
    expect(cruiseStaysEngaged(keys(false, true))).toBe(false);
  });

  it('stays on through hand brake gestures and lost tracking', () => {
    expect(cruiseStaysEngaged({ ...hands, braking: true, brakePressure: 0.5 })).toBe(true);
    expect(cruiseStaysEngaged({ ...hands, braking: true, brakePressure: 1 })).toBe(true);
    expect(cruiseStaysEngaged({ ...hands, active: false })).toBe(true);
  });
});

describe('adaptive cruise radar', () => {
  const car = (distance: number, lane: number, speed = 25, direction: 1 | -1 = 1): RadarTarget => ({
    distance,
    lane,
    laneOffset: 0,
    speed,
    direction,
  });

  it('picks the nearest car ahead in the player lane only', () => {
    const traffic = [car(160, 0), car(90, 0), car(60, 1), car(-30, 0)];
    const lead = findLeadVehicle(100 - 60, laneOffsets[0], 1, CAR_LENGTH, traffic)!;
    expect(lead.gap).toBeCloseTo(90 - 40 - CAR_LENGTH, 9);
    expect(lead.speed).toBe(25);
  });

  it('ignores cars beyond radar range or in neighbouring lanes', () => {
    expect(findLeadVehicle(0, laneOffsets[0], 1, CAR_LENGTH, [car(ACC_RANGE + 20, 0)])).toBeNull();
    expect(findLeadVehicle(0, laneOffsets[0], 1, CAR_LENGTH, [car(50, 1)])).toBeNull();
  });

  it('looks the way the player faces after a U-turn, and sees oncoming cars as closing', () => {
    const traffic = [car(40, 2, 30, -1), car(-60, 2, 30, -1), car(-50, 2, 30, 1)];
    const lead = findLeadVehicle(0, laneOffsets[2], -1, CAR_LENGTH, traffic)!;
    expect(lead.gap).toBeCloseTo(50 - CAR_LENGTH, 9);
    // A car in the lane driving toward the player has negative speed along its way.
    expect(lead.speed).toBe(-30);
  });
});

describe('adaptive cruise speed', () => {
  it('holds the set speed on a clear road and eases off above it', () => {
    const below = planAdaptiveCruise(kph(100), kph(70), null);
    expect(below).toMatchObject({ targetSpeed: kph(100), status: 'cruising', braking: false });
    expect(below.acceleration).toBe(driveAcceleration(kph(70)));
    const above = planAdaptiveCruise(kph(100), kph(130), null);
    expect(above.acceleration).toBe(GAME.coastDeceleration);
    expect(above.braking).toBe(false);
  });

  it('ignores a car far enough ahead that it does not limit the set speed', () => {
    expect(planAdaptiveCruise(kph(80), kph(80), { gap: 140, speed: 30 }).status).toBe('cruising');
  });

  it('settles at the lead car speed at the time gap', () => {
    const speed = 25;
    const gap = ACC_STANDSTILL_GAP + ACC_TIME_GAP * speed;
    const plan = planAdaptiveCruise(kph(120), speed, { gap, speed });
    expect(plan.targetSpeed).toBeCloseTo(speed, 9);
    expect(plan.status).toBe('following');
  });

  it('brakes harder the faster it closes on a slower car', () => {
    const gentle = planAdaptiveCruise(kph(120), 30, { gap: 60, speed: 26 });
    const urgent = planAdaptiveCruise(kph(160), 50, { gap: 40, speed: 0 });
    expect(gentle.targetSpeed).toBeLessThan(30);
    expect(gentle.status).toBe('following');
    expect(urgent.acceleration).toBeGreaterThan(gentle.acceleration);
    expect(urgent.acceleration).toBeGreaterThan(GAME.serviceBrake);
    expect(urgent.braking).toBe(true);
    expect(urgent.status).toBe('braking');
  });

  it('stops behind a stopped car and pulls away when it moves off', () => {
    const stopped = planAdaptiveCruise(kph(80), 0, { gap: ACC_STANDSTILL_GAP, speed: 0 });
    expect(stopped.targetSpeed).toBe(0);
    const movingOff = planAdaptiveCruise(kph(80), 0, { gap: 30, speed: 8 });
    expect(movingOff.targetSpeed).toBeGreaterThan(0);
  });

  it('drives the speed plan, braking lamps included', () => {
    const plan = createSpeedPlan(keys(false, false), 33, {
      cruiseKph: 120,
      lead: { gap: 30, speed: 0 },
    });
    expect(plan.targetSpeed).toBe(0);
    expect(plan.braking).toBe(true);
    expect(plan.assistMessage).toBe('ACC BRAKING');
    expect(plan.cruiseStatus).toBe('braking');
    // Hands drive at the set speed instead of running up to top speed.
    expect(createSpeedPlan(hands, kph(60), { cruiseKph: 80 }).targetSpeed).toBeCloseTo(kph(80), 9);
    expect(createSpeedPlan(hands, kph(60)).targetSpeed).toBe(GAME.maxSpeed);
  });

  it('gives way to hand brake gestures and lost hands, then takes back over', () => {
    const thumbs = { ...hands, braking: true, brakePressure: 0.5 };
    const halfBrake = createSpeedPlan(thumbs, kph(100), { cruiseKph: 100 });
    expect(halfBrake.cruiseStatus).toBeUndefined();
    expect(halfBrake.targetSpeed).toBeLessThanOrEqual(kph(100));
    expect(halfBrake.braking).toBe(true);

    const lost = createSpeedPlan({ ...hands, active: false }, kph(100), { cruiseKph: 100 });
    expect(lost.autoBraking).toBe(true);
    expect(lost.targetSpeed).toBe(0);

    const gripping = createSpeedPlan(hands, kph(60), { cruiseKph: 100 });
    expect(gripping.cruiseStatus).toBe('cruising');
    expect(gripping.targetSpeed).toBeCloseTo(kph(100), 9);
  });

  it('lets keyboard drivers accelerate past it, and gives way to the brake', () => {
    const overtaking = createSpeedPlan(keys(true, false), kph(90), {
      cruiseKph: 90,
      lead: { gap: 20, speed: 20 },
    });
    expect(overtaking.targetSpeed).toBe(GAME.maxSpeed);
    expect(overtaking.cruiseStatus).toBeUndefined();
    const braking = createSpeedPlan(keys(false, true), kph(90), { cruiseKph: 90 });
    expect(braking.targetSpeed).toBe(0);
    expect(braking.braking).toBe(true);
  });
});
