export const GAME = {
  roadWidth: 28,
  laneWidth: 11.5,
  maxSpeed: 45,
  minCurveSpeed: 18,
  acceleration: 8,
  serviceBrake: 13,
  emergencyBrake: 25,
  steeringRate: 8.5,
  maxLateral: 11.9,
  roadEdgeMargin: 2.1,
  trafficCount: 16,
  lookAhead: 260,
  lookBehind: 55,
  collisionLength: 9.2,
  collisionWidth: 3.9,
  conceptCollisionLength: 9.9,
  conceptCollisionWidth: 4.45,
} as const;

export const laneOffsets = [-GAME.laneWidth / 2, GAME.laneWidth / 2] as const;
