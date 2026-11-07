import type { ReverseGear } from './types';

export const TRAFFIC_COUNT_OPTIONS = [0, 4, 8, 12, 16] as const;

/**
 * The road and cars are modelled at twice real size (a 7.5-unit lane is a
 * 3.75 m lane, a 9.2-unit car a 4.6 m car), so speeds and distances shown to
 * the player convert at two world units per metre.
 */
export const WORLD_UNITS_PER_METER = 2;

/** World units per second to the km/h shown on the speedometer. */
export function toKph(speed: number): number {
  return (speed / WORLD_UNITS_PER_METER) * 3.6;
}

/** km/h to world units per second. */
export function fromKph(kph: number): number {
  return (kph / 3.6) * WORLD_UNITS_PER_METER;
}

/** World units to metres. */
export function toMeters(units: number): number {
  return units / WORLD_UNITS_PER_METER;
}

export const MAX_SPEED_KPH = 150;
/** The half brake (both thumbs up) slows the car to this speed and holds it there. */
export const HALF_BRAKE_KPH = 40;

export const GAME = {
  roadWidth: 36,
  /** Four lanes, two each way, fill the space between the painted edge lines. */
  laneWidth: 7.5,
  /** Half the width of the double yellow centre line painted on the road. */
  centerLineHalfWidth: 1,
  /** Traffic drifts at most this far from its lane centre. */
  trafficLaneJitter: 0.8,
  /** 150 km/h. */
  maxSpeed: fromKph(MAX_SPEED_KPH),
  /** Full-throttle acceleration from rest (about 6 m/s², 0–100 km/h in ~5 s); it tapers toward top speed. */
  acceleration: 12,
  /** Lifting off: rolling resistance and engine braking (about 1.2 m/s²). */
  coastDeceleration: 2.4,
  /** Full braking, about 0.9 g. */
  serviceBrake: 18,
  /** How quickly reverse speed builds. */
  reverseAcceleration: 5,
  /** Holding the full brake below this speed counts as a standstill. */
  reverseEngageSpeed: 0.5,
  steeringRate: 8.5,
  roadEdgeMargin: 2.1,
  trafficCount: 16,
  /** Road built ahead of the view: about five seconds of road at top speed. */
  lookAhead: 420,
  lookBehind: 55,
  collisionLength: 9.2,
  collisionWidth: 3.9,
  conceptCollisionLength: 9.9,
  conceptCollisionWidth: 4.45,
} as const;

/** Keyboard: keep holding the brake once stopped to back up at up to 30 km/h. */
export const KEYBOARD_REVERSE: ReverseGear = { delaySeconds: 0, maxSpeed: fromKph(30) };

/**
 * Hands: keep both palms open for a second after stopping to back up slowly
 * (15 km/h). The pause keeps a plain full stop from rolling backward.
 */
export const HAND_REVERSE: ReverseGear = { delaySeconds: 1, maxSpeed: fromKph(15) };

/**
 * Throttle tapers with speed, as drag and gearing do in a real car: full
 * acceleration from rest, a long pull toward top speed.
 */
export function driveAcceleration(speed: number): number {
  const fraction = Math.min(1, Math.max(0, speed) / GAME.maxSpeed);
  return GAME.acceleration * Math.max(0.18, 1 - fraction * fraction);
}

/**
 * Lane centres from left to right. Traffic drives on the left: lanes 0 and 1
 * carry same-direction traffic (0 is the outer lane), lanes 2 and 3 oncoming.
 */
export const laneOffsets = [
  -(GAME.centerLineHalfWidth + GAME.laneWidth * 1.5),
  -(GAME.centerLineHalfWidth + GAME.laneWidth * 0.5),
  GAME.centerLineHalfWidth + GAME.laneWidth * 0.5,
  GAME.centerLineHalfWidth + GAME.laneWidth * 1.5,
] as const;

/** Dashed dividers between the two lanes on each side of the centre line. */
export const laneDividerOffsets = [
  -(GAME.centerLineHalfWidth + GAME.laneWidth),
  GAME.centerLineHalfWidth + GAME.laneWidth,
] as const;
