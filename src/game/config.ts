export const GAME = {
  roadWidth: 20,
  laneWidth: 8.4,
  maxSpeed: 45,
  minCurveSpeed: 18,
  acceleration: 8,
  serviceBrake: 13,
  emergencyBrake: 25,
  steeringRate: 8.5,
  maxLateral: 7.6,
  trafficCount: 16,
  lookAhead: 260,
  lookBehind: 55,
  collisionLength: 9.2,
  collisionWidth: 3.9,
} as const;

export const laneOffsets = [-GAME.laneWidth / 2, GAME.laneWidth / 2] as const;
