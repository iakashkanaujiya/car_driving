import { GAME } from '../config';

/**
 * How traffic drives behind other cars: the Intelligent Driver Model, a
 * standard car-following model that keeps a safe time gap, brakes harder the
 * faster it closes in and settles behind a stopped car at a small gap. All
 * values are in world units (two per metre) and seconds.
 */
export const TRAFFIC_DRIVER = {
  /** Gentle pull-away, about 3 m/s². */
  acceleration: 6,
  /** Braking a driver is comfortable with, about 3 m/s². */
  comfortableBraking: 6,
  /** Emergency braking, the same 0.9 g as the player's footbrake. */
  maxBraking: GAME.serviceBrake,
  /** Bumper-to-bumper gap kept when stopped, about 2.5 m. */
  standstillGap: 5,
  /** Seconds of travel kept between bumpers at speed. */
  timeHeadway: 1.4,
} as const;

/** What a traffic car sees ahead in its lane. */
export interface TrafficLead {
  /** Bumper-to-bumper gap, in world units. */
  gap: number;
  /** The lead's speed along the follower's direction; negative when it drives toward it. */
  speed: number;
}

/**
 * Acceleration (negative when braking) for a traffic car doing `speed` that
 * would like to drive at `desiredSpeed`, with `lead` ahead in its lane.
 */
export function trafficAcceleration(
  speed: number,
  desiredSpeed: number,
  lead: TrafficLead | null,
): number {
  const { acceleration, comfortableBraking, maxBraking, standstillGap, timeHeadway } =
    TRAFFIC_DRIVER;
  const free = desiredSpeed > 0 ? 1 - Math.pow(Math.max(0, speed) / desiredSpeed, 4) : -1;
  let interaction = 0;
  if (lead) {
    const closing = speed - lead.speed;
    const desiredGap =
      standstillGap +
      Math.max(
        0,
        speed * timeHeadway +
          (speed * closing) / (2 * Math.sqrt(acceleration * comfortableBraking)),
      );
    interaction = Math.pow(desiredGap / Math.max(lead.gap, 0.1), 2);
  }
  return Math.max(-maxBraking, acceleration * (free - interaction));
}

/** A car on the road, as the lead search sees it. */
export interface RoadUser {
  /** Position along the road, in world units. */
  distance: number;
  /** Sideways offset from the road centre line. */
  lateral: number;
  length: number;
  width: number;
  /** Speed along the road's distance axis; negative toward smaller distances. */
  velocity: number;
}

/**
 * The nearest road user ahead of `follower` (driving toward larger distances
 * when `direction` is 1) that overlaps its lane sideways, within `range`.
 */
export function findTrafficLead(
  follower: RoadUser,
  direction: 1 | -1,
  others: readonly RoadUser[],
  range = 260,
): TrafficLead | null {
  let lead: TrafficLead | null = null;
  for (const other of others) {
    if (other === follower) continue;
    const sideways = Math.abs(other.lateral - follower.lateral);
    if (sideways >= (other.width + follower.width) / 2) continue;
    const ahead = (other.distance - follower.distance) * direction;
    if (ahead <= 0 || ahead > range) continue;
    const gap = ahead - (other.length + follower.length) / 2;
    if (!lead || gap < lead.gap) lead = { gap, speed: other.velocity * direction };
  }
  return lead;
}
