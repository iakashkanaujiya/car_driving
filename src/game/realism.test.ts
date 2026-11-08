import { describe, expect, it } from 'vitest';
import { engineFrequency, engineVolume } from '../audio/EngineSound';
import { fromKph, GAME, MAX_SPEED_KPH, toKph, toMeters, WORLD_UNITS_PER_METER } from './config';
import { damp, MAX_LATERAL_ACCELERATION, roadCenter, steeringYawRate } from './math';
import { createSpeedPlan } from './simulation/drivingAssist';

const throttle = {
  steering: 0,
  confidence: 1,
  active: true,
  accelerating: true,
  braking: false,
};

/** Seconds of full throttle, stepped exactly as the game loop steps speed, to reach `kph`. */
function secondsTo(kph: number, limit = 60): number {
  const dt = 1 / 60;
  let speed = 0;
  for (let time = 0; time < limit; time += dt) {
    if (toKph(speed) >= kph) return time;
    const { targetSpeed, acceleration } = createSpeedPlan(throttle, speed);
    speed = damp(speed, targetSpeed, acceleration / Math.max(8, Math.abs(targetSpeed - speed)), dt);
  }
  return Number.POSITIVE_INFINITY;
}

describe('real-world scale', () => {
  it('reads speeds and distances at the size the road and cars are drawn', () => {
    // A 7.5-unit lane is a 3.75 m lane, so two units make a metre.
    expect(GAME.laneWidth / WORLD_UNITS_PER_METER).toBeCloseTo(3.75, 9);
    expect(toKph(fromKph(123))).toBeCloseTo(123, 9);
    expect(toMeters(1000)).toBe(500);
    expect(toKph(GAME.maxSpeed)).toBeCloseTo(MAX_SPEED_KPH, 9);
    expect(MAX_SPEED_KPH).toBe(150);
  });

  it('pulls like a quick road car: brisk to 100, a longer pull toward top speed', () => {
    const to100 = secondsTo(100);
    expect(to100).toBeGreaterThan(4);
    expect(to100).toBeLessThan(7);
    const to140 = secondsTo(140);
    expect(to140).toBeGreaterThan(to100 * 1.8);
    expect(to140).toBeLessThan(20);
    expect(secondsTo(MAX_SPEED_KPH + 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('brakes at about 0.9 g', () => {
    const metresPerSecondSquared = toMeters(GAME.serviceBrake);
    expect(metresPerSecondSquared / 9.81).toBeGreaterThan(0.8);
    expect(metresPerSecondSquared / 9.81).toBeLessThan(1);
  });

  it('has the grip for the tightest bend at top speed, and no snap turns beyond it', () => {
    let curvature = 0;
    for (let distance = 0; distance < 6000; distance += 2) {
      const bend = roadCenter(distance + 1) - 2 * roadCenter(distance) + roadCenter(distance - 1);
      curvature = Math.max(curvature, Math.abs(bend));
    }
    expect(GAME.maxSpeed * GAME.maxSpeed * curvature).toBeLessThan(MAX_LATERAL_ACCELERATION);
    expect(steeringYawRate(1, GAME.maxSpeed) * GAME.maxSpeed).toBeCloseTo(
      MAX_LATERAL_ACCELERATION,
      6,
    );
  });

  it('revs up through each gear and drops on the upshift', () => {
    expect(engineFrequency(0)).toBeLessThan(engineFrequency(30));
    expect(engineFrequency(31)).toBeGreaterThan(engineFrequency(33));
    expect(engineFrequency(107)).toBeGreaterThan(engineFrequency(109));
    for (let kph = 0; kph <= MAX_SPEED_KPH; kph += 5) {
      expect(engineFrequency(kph)).toBeGreaterThanOrEqual(46);
      expect(engineFrequency(kph)).toBeLessThanOrEqual(172);
    }
  });

  it('silences the engine at a standstill and gets louder with speed', () => {
    expect(engineVolume(0)).toBe(0);
    expect(engineVolume(20)).toBeGreaterThan(0);
    expect(engineVolume(MAX_SPEED_KPH)).toBeGreaterThan(engineVolume(60));
    // Twice the idle level at most, so the limiter rarely has to work.
    expect(engineVolume(MAX_SPEED_KPH)).toBeLessThan(engineVolume(2) * 2.2);
  });
});
