export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
export const damp = (from: number, to: number, lambda: number, dt: number): number =>
  lerp(from, to, 1 - Math.exp(-lambda * dt));

export function roadCenter(distance: number): number {
  return (
    Math.sin(distance * 0.0065) * 17 +
    Math.sin(distance * 0.014 + 1.8) * 7 +
    Math.sin(distance * 0.0021 + 0.4) * 25
  );
}

export function roadHeading(distance: number): number {
  const step = 0.5;
  return Math.atan2(-(roadCenter(distance + step) - roadCenter(distance - step)), step * 2);
}

export function steeringFromHands(
  left: { x: number; y: number },
  right: { x: number; y: number },
  neutralAngle: number,
  deadZone = 0.045,
): number {
  // Reach full steering with a comfortable hand rotation while preserving a
  // small neutral zone that filters camera-tracking jitter.
  const steeringRange = 0.56;
  const angle = Math.atan2(right.y - left.y, right.x - left.x);
  let delta = Math.atan2(Math.sin(angle - neutralAngle), Math.cos(angle - neutralAngle));
  if (Math.abs(delta) <= deadZone) return 0;
  delta -= Math.sign(delta) * deadZone;
  return clamp(delta / steeringRange, -1, 1);
}

/** Full-lock yaw rate at speed, in radians per second. */
const MAX_YAW_RATE = 0.82;
/** Tightest turning circle radius in world units, so the car can never pivot in place. */
export const MIN_TURN_RADIUS = 13;

/**
 * Yaw rate (radians per second, positive turns left) for a steering input.
 * Like a real car it scales with speed: a stopped car only turns its wheels,
 * slow turns never get tighter than MIN_TURN_RADIUS, and steering swings the
 * nose the other way in reverse.
 */
export function steeringYawRate(steering: number, speed: number): number {
  const absoluteSpeed = Math.abs(speed);
  const authority = Math.min(
    0.28 + 0.72 * clamp(absoluteSpeed / 18, 0, 1),
    absoluteSpeed / (MAX_YAW_RATE * MIN_TURN_RADIUS),
  );
  return steering * MAX_YAW_RATE * authority * (speed < 0 ? -1 : 1);
}

/**
 * Start of the stretch of road a scene system keeps built: `length` long, with
 * `behind` of it behind the view. `viewAlong` is the cosine between the view
 * and the road's forward direction, so turning around slides the stretch
 * smoothly until it sits ahead in the new direction.
 */
export function roadWindowStart(
  playerDistance: number,
  viewAlong: number,
  length: number,
  behind: number,
): number {
  return playerDistance + (length / 2 - behind) * clamp(viewAlong, -1, 1) - length / 2;
}

/** Shifts `distance` by whole rings into `[start, start + ringLength)`; recycled slots keep their layout. */
export function wrapIntoWindow(distance: number, start: number, ringLength: number): number {
  if (distance >= start && distance < start + ringLength) return distance;
  return start + ((((distance - start) % ringLength) + ringLength) % ringLength);
}

export function constrainToRoad(
  worldX: number,
  centerX: number,
  roadHeadingAngle: number,
  roadWidth: number,
  vehicleHalfWidth: number,
): { worldX: number; lateral: number; boundary: -1 | 0 | 1 } {
  const sideScale = Math.max(0.72, Math.cos(roadHeadingAngle));
  const lateral = (worldX - centerX) / sideScale;
  const limit = roadWidth / 2 - vehicleHalfWidth;
  const constrained = clamp(lateral, -limit, limit);
  return {
    worldX: centerX + sideScale * constrained,
    lateral: constrained,
    boundary: lateral < -limit ? -1 : lateral > limit ? 1 : 0,
  };
}
