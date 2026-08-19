export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
export const damp = (from: number, to: number, lambda: number, dt: number): number =>
  lerp(from, to, 1 - Math.exp(-lambda * dt));
export const inverseLerp = (from: number, to: number, value: number): number =>
  clamp((value - from) / (to - from), 0, 1);

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

export function roadCurvature(distance: number): number {
  const step = 5;
  const a = roadHeading(distance - step);
  const b = roadHeading(distance + step);
  return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) / (step * 2);
}

export function steeringFromHands(
  left: { x: number; y: number },
  right: { x: number; y: number },
  neutralAngle: number,
  deadZone = 0.045,
): number {
  const angle = Math.atan2(right.y - left.y, right.x - left.x);
  let delta = Math.atan2(Math.sin(angle - neutralAngle), Math.cos(angle - neutralAngle));
  if (Math.abs(delta) <= deadZone) return 0;
  delta -= Math.sign(delta) * deadZone;
  return clamp(delta / 0.72, -1, 1);
}

export function curveSpeedLimit(distance: number, maxSpeed: number, minSpeed: number): number {
  let peak = 0;
  for (let ahead = 22; ahead <= 105; ahead += 12)
    peak = Math.max(peak, roadCurvature(distance + ahead));
  return lerp(maxSpeed, minSpeed, inverseLerp(0.002, 0.012, peak));
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
