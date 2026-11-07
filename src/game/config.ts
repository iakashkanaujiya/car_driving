import type { ReverseGear } from './types';

export const TRAFFIC_COUNT_OPTIONS = [0, 4, 8, 12, 16] as const;

export const GAME = {
  roadWidth: 36,
  /** Four lanes, two each way, fill the space between the painted edge lines. */
  laneWidth: 7.5,
  /** Half the width of the double yellow centre line painted on the road. */
  centerLineHalfWidth: 1,
  /** Traffic drifts at most this far from its lane centre. */
  trafficLaneJitter: 0.8,
  maxSpeed: 45,
  acceleration: 8,
  coastDeceleration: 2.4,
  serviceBrake: 13,
  /** How quickly reverse speed builds. */
  reverseAcceleration: 5,
  /** Holding the full brake below this speed counts as a standstill. */
  reverseEngageSpeed: 0.5,
  steeringRate: 8.5,
  roadEdgeMargin: 2.1,
  trafficCount: 16,
  lookAhead: 260,
  lookBehind: 55,
  collisionLength: 9.2,
  collisionWidth: 3.9,
  conceptCollisionLength: 9.9,
  conceptCollisionWidth: 4.45,
} as const;

/** Keyboard: keep holding the brake once stopped to back up at up to about 32 km/h. */
export const KEYBOARD_REVERSE: ReverseGear = { delaySeconds: 0, maxSpeed: 9 };

/**
 * Hands: keep both palms open for a second after stopping to back up slowly
 * (about 18 km/h). The pause keeps a plain full stop from rolling backward.
 */
export const HAND_REVERSE: ReverseGear = { delaySeconds: 1, maxSpeed: 5 };

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
