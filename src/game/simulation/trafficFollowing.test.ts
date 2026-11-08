import { describe, expect, it } from 'vitest';
import { fromKph, GAME, toKph, WORLD_UNITS_PER_METER } from '../config';
import { findTrafficLead, TRAFFIC_DRIVER, trafficAcceleration } from './trafficFollowing';
import type { RoadUser, TrafficLead } from './trafficFollowing';

const dt = 1 / 60;

/** Drives one follower behind a lead that moves at `leadSpeed`, returning the closest gap. */
function follow(
  speed: number,
  gap: number,
  leadSpeed: (time: number) => number,
  seconds: number,
): { speed: number; gap: number; closest: number } {
  let closest = gap;
  for (let frame = 0; frame < seconds / dt; frame += 1) {
    const lead: TrafficLead = { gap, speed: leadSpeed(frame * dt) };
    speed = Math.max(0, speed + trafficAcceleration(speed, fromKph(120), lead) * dt);
    gap += (lead.speed - speed) * dt;
    closest = Math.min(closest, gap);
  }
  return { speed, gap, closest };
}

describe('traffic following', () => {
  it('cruises at its chosen speed on an open road', () => {
    expect(trafficAcceleration(0, fromKph(100), null)).toBeCloseTo(TRAFFIC_DRIVER.acceleration);
    expect(Math.abs(trafficAcceleration(fromKph(100), fromKph(100), null))).toBeLessThan(1e-9);
    // Above its chosen speed it eases off.
    expect(trafficAcceleration(fromKph(120), fromKph(100), null)).toBeLessThan(0);
  });

  it('stops behind a stopped car instead of driving into it', () => {
    const result = follow(fromKph(130), 220, () => 0, 20);
    expect(result.speed).toBeLessThan(0.05);
    expect(result.closest).toBeGreaterThan(TRAFFIC_DRIVER.standstillGap * 0.8);
  });

  it('follows a slower car at a steady, safe gap', () => {
    const leadSpeed = fromKph(70);
    const result = follow(fromKph(120), 120, () => leadSpeed, 40);
    expect(toKph(result.speed)).toBeCloseTo(70, 0);
    // Close to the standstill gap plus 1.4 s of travel.
    const expected = TRAFFIC_DRIVER.standstillGap + leadSpeed * TRAFFIC_DRIVER.timeHeadway;
    expect(result.gap / expected).toBeGreaterThan(0.95);
    expect(result.gap / expected).toBeLessThan(1.3);
  });

  it('pulls away again once the car ahead drives off', () => {
    const result = follow(
      0,
      TRAFFIC_DRIVER.standstillGap,
      (time) => (time < 2 ? 0 : fromKph(90)),
      30,
    );
    expect(toKph(result.speed)).toBeGreaterThan(85);
  });

  it('brakes harder for a car driving toward it than for a stopped one', () => {
    const speed = fromKph(100);
    const stopped = trafficAcceleration(speed, speed, { gap: 300, speed: 0 });
    const oncoming = trafficAcceleration(speed, speed, { gap: 300, speed: -fromKph(60) });
    expect(oncoming).toBeLessThan(stopped);
    expect(oncoming).toBeGreaterThanOrEqual(-TRAFFIC_DRIVER.maxBraking);
  });

  it('keeps a queue from colliding when the front car brakes as hard as it can', () => {
    const length = GAME.collisionLength;
    const cars = Array.from({ length: 6 }, (_, index) => ({
      distance: -index * (length + 5 + fromKph(110) * TRAFFIC_DRIVER.timeHeadway),
      speed: fromKph(110),
    }));
    let closest = Infinity;
    for (let frame = 0; frame < 25 / dt; frame += 1) {
      cars.forEach((car, index) => {
        let acceleration: number;
        if (index === 0) {
          // The front car stops at 0.9 g, as if the player slammed on the brakes.
          acceleration = car.speed > 0 ? -GAME.serviceBrake : 0;
        } else {
          const ahead = cars[index - 1];
          const lead = { gap: ahead.distance - car.distance - length, speed: ahead.speed };
          acceleration = trafficAcceleration(car.speed, fromKph(120), lead);
        }
        car.speed = Math.max(0, car.speed + acceleration * dt);
      });
      cars.forEach((car) => (car.distance += car.speed * dt));
      for (let index = 1; index < cars.length; index += 1) {
        closest = Math.min(closest, cars[index - 1].distance - cars[index].distance - length);
      }
    }
    expect(closest).toBeGreaterThan(0);
    expect(cars.every((car) => car.speed < 0.05)).toBe(true);
    // Everyone ends up stopped a metre or more apart.
    expect(closest).toBeGreaterThan(1 * WORLD_UNITS_PER_METER);
  });
});

describe('traffic lead search', () => {
  const user = (distance: number, lateral: number, velocity = 0): RoadUser => ({
    distance,
    lateral,
    length: 9,
    width: 4,
    velocity,
  });

  it('finds the nearest car ahead in the same lane', () => {
    const follower = user(0, 5);
    const lead = findTrafficLead(follower, 1, [
      follower,
      user(80, 5, 20),
      user(40, 5.6, 10),
      user(-20, 5),
      user(30, -5),
    ]);
    expect(lead).toEqual({ gap: 31, speed: 10 });
  });

  it('sees a car driving the other way in its lane as approaching', () => {
    const follower = user(100, 5);
    // Driving toward smaller distances, the lead is at 60 and coming at 30 units/s.
    const lead = findTrafficLead(follower, -1, [follower, user(60, 5, 30)]);
    expect(lead).toEqual({ gap: 31, speed: -30 });
  });

  it('ignores cars only beside it or out of range', () => {
    const follower = user(0, 0);
    expect(findTrafficLead(follower, 1, [follower, user(30, 4.2), user(400, 0)])).toBeNull();
  });
});
