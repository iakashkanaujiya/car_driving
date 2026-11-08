import { driveAcceleration, GAME, laneOffsets, MAX_SPEED_KPH } from '../config';
import { clamp } from '../math';
import type { ControlInput, CruiseStatus } from '../types';

export const CRUISE_MIN_KPH = 20;
export const CRUISE_MAX_KPH = MAX_SPEED_KPH;
/** Each + / − press moves the set speed to the next multiple of this. */
export const CRUISE_STEP_KPH = 5;
export const CRUISE_DEFAULT_KPH = 80;

/** Radar range in world units (160 m): enough to settle in behind a car from top speed. */
export const ACC_RANGE = 320;
/** Bumper-to-bumper gap kept when stopped behind a car (3.5 m). */
export const ACC_STANDSTILL_GAP = 7;
/** Following distance in seconds of travel at the current speed. */
export const ACC_TIME_GAP = 1.6;
/** How strongly a gap error turns into a speed change, per second. */
const GAP_GAIN = 0.4;
/**
 * Gentle slowing for a car ahead (about 2 m/s²), harder braking up to the
 * emergency limit (about 1 g), in world units per second squared.
 */
const COMFORT_BRAKE = 4;
const EMERGENCY_BRAKE = 20;
/** Above this deceleration the HUD reports ACC as braking. */
const HARD_BRAKE = 8;
/** Lateral distance within which a car counts as in the player's lane. */
const LANE_CORRIDOR = GAME.collisionWidth + 1.5;

/** A car the radar can see; matches the game's traffic records. */
export interface RadarTarget {
  distance: number;
  lane: number;
  laneOffset: number;
  speed: number;
  direction: 1 | -1;
}

export interface LeadVehicle {
  /** Bumper-to-bumper gap along the way the player faces. */
  gap: number;
  /** The lead's speed along the player's direction; negative when it drives toward the player. */
  speed: number;
}

export interface CruisePlan {
  targetSpeed: number;
  acceleration: number;
  braking: boolean;
  status: Exclude<CruiseStatus, 'off'>;
}

/** Moves the set speed up (+1) or down (−1) to the next whole step, within limits. */
export function adjustCruise(setKph: number, direction: 1 | -1): number {
  const stepped =
    direction > 0
      ? Math.floor(setKph / CRUISE_STEP_KPH + 1) * CRUISE_STEP_KPH
      : Math.ceil(setKph / CRUISE_STEP_KPH - 1) * CRUISE_STEP_KPH;
  return clamp(stepped, CRUISE_MIN_KPH, CRUISE_MAX_KPH);
}

/**
 * Whether adaptive cruise stays switched on. A keyboard brake press cancels
 * it, like a real pedal. Hand brake gestures are the only way to slow down
 * with hands, so they (and lost tracking, which brakes too) just override it.
 */
export function cruiseStaysEngaged(control: ControlInput): boolean {
  // Pulling the handbrake switches cruise off in any mode, as on a real car.
  if (control.handbrake) return false;
  if (!control.brakeCancelsCruise) return true;
  return !(control.braking === true || (control.brakePressure ?? 0) > 0);
}

/** Whether adaptive cruise is driving right now, rather than switched on but overridden. */
export function cruiseIsDriving(control: ControlInput): boolean {
  const braking =
    control.braking === true || (control.brakePressure ?? 0) > 0 || control.handbrake === true;
  return control.active && !braking && control.accelerating !== true;
}

/** The nearest car ahead in the player's lane within radar range, if any. */
export function findLeadVehicle(
  playerDistance: number,
  playerLateral: number,
  facing: 1 | -1,
  carLength: number,
  cars: readonly RadarTarget[],
): LeadVehicle | null {
  let lead: LeadVehicle | null = null;
  for (const car of cars) {
    const ahead = (car.distance - playerDistance) * facing;
    if (ahead <= 0) continue;
    const gap = ahead - carLength;
    if (gap > ACC_RANGE || (lead && gap >= lead.gap)) continue;
    const lateral = laneOffsets[car.lane] + car.laneOffset;
    if (Math.abs(lateral - playerLateral) > LANE_CORRIDOR) continue;
    lead = { gap, speed: car.speed * car.direction * facing };
  }
  return lead;
}

/**
 * Adaptive cruise: hold the set speed on a clear road; behind a car, match
 * its speed at a time gap that grows with speed, braking as hard as the
 * closing speed demands, down to a stop and back up again.
 */
export function planAdaptiveCruise(
  setSpeed: number,
  currentSpeed: number,
  lead: LeadVehicle | null,
): CruisePlan {
  const free: CruisePlan = {
    targetSpeed: setSpeed,
    // Above the set speed it eases off, as if lifting off the pedal.
    acceleration:
      setSpeed >= currentSpeed ? driveAcceleration(currentSpeed) : GAME.coastDeceleration,
    braking: false,
    status: 'cruising',
  };
  if (!lead) return free;

  const speed = Math.max(0, currentSpeed);
  const desiredGap = ACC_STANDSTILL_GAP + ACC_TIME_GAP * speed;
  const followSpeed = lead.speed + (lead.gap - desiredGap) * GAP_GAIN;
  if (followSpeed >= setSpeed) return free;

  const targetSpeed = clamp(followSpeed, 0, setSpeed);
  if (targetSpeed >= speed) {
    return {
      targetSpeed,
      acceleration: driveAcceleration(speed) * 0.7,
      braking: false,
      status: 'following',
    };
  }
  // Deceleration that matches the lead's speed before the standstill gap is used up.
  const closing = speed - Math.max(lead.speed, 0);
  const room = Math.max(lead.gap - ACC_STANDSTILL_GAP, 0.5);
  const needed = closing > 0 ? (closing * closing) / (2 * room) : 0;
  const acceleration = clamp(needed * 1.3, COMFORT_BRAKE, EMERGENCY_BRAKE);
  return {
    targetSpeed,
    acceleration,
    braking: acceleration > GAME.coastDeceleration,
    status: acceleration > HARD_BRAKE ? 'braking' : 'following',
  };
}
