import { driveAcceleration, fromKph, GAME, HALF_BRAKE_KPH } from '../config';
import { clamp, lerp } from '../math';
import type { ControlInput, CruiseStatus } from '../types';
import { cruiseIsDriving, planAdaptiveCruise } from './cruiseControl';
import type { LeadVehicle } from './cruiseControl';

export interface SpeedPlan {
  /** Negative while reversing. */
  targetSpeed: number;
  acceleration: number;
  /** The car is stopping on its own because hand tracking lost the player. */
  autoBraking: boolean;
  /** The driver or adaptive cruise is slowing the car with the brake (lights the brake lamps). */
  braking: boolean;
  assistMessage: string;
  /** Set while adaptive cruise is driving the car. */
  cruiseStatus?: Exclude<CruiseStatus, 'off'>;
}

const CRUISE_MESSAGES: Record<Exclude<CruiseStatus, 'off'>, string> = {
  cruising: 'ADAPTIVE CRUISE',
  following: 'ACC FOLLOWING',
  braking: 'ACC BRAKING',
};

/** Below this speed the car counts as rolling backward. */
const REVERSE_ROLL_SPEED = -0.05;
const STOPPED_SPEED = 0.3;

/**
 * Seconds the full brake has been held at a standstill (or while reversing).
 * Reverse engages once this reaches the input's `reverseGear.delaySeconds`.
 */
export function updateReverseHold(
  heldSeconds: number,
  control: ControlInput,
  currentSpeed: number,
  dt: number,
): number {
  const fullBrake = control.active && getBrakePressure(control) >= 1;
  return fullBrake && currentSpeed <= GAME.reverseEngageSpeed ? heldSeconds + dt : 0;
}

export interface SpeedPlanOptions {
  /** Seconds the full brake has been held at a standstill (see updateReverseHold). */
  reverseHoldSeconds?: number;
  /** Adaptive cruise set speed in km/h, or null when it is off. */
  cruiseKph?: number | null;
  /** The car ahead in the player's lane, as seen by the cruise radar. */
  lead?: LeadVehicle | null;
}

/**
 * Converts player intent into a deterministic speed plan. Without adaptive
 * cruise, traffic and curves never slow the car: avoiding them is up to the
 * player, and the only automatic braking is the stop when hand controls go
 * inactive. With it on, the car brakes for the car ahead in its lane.
 */
export function createSpeedPlan(
  control: ControlInput,
  currentSpeed: number,
  { reverseHoldSeconds = 0, cruiseKph = null, lead = null }: SpeedPlanOptions = {},
): SpeedPlan {
  const reverse = planReverse(control, currentSpeed, reverseHoldSeconds);
  if (reverse) return reverse;
  // Adaptive cruise drives unless the driver brakes, loses tracking or (on
  // the keyboard) presses the accelerator to overtake; then it takes back over.
  if (cruiseKph !== null && cruiseIsDriving(control)) {
    const cruise = planAdaptiveCruise(fromKph(cruiseKph), currentSpeed, lead);
    return {
      targetSpeed: cruise.targetSpeed,
      acceleration: cruise.acceleration,
      autoBraking: false,
      braking: cruise.braking,
      assistMessage: CRUISE_MESSAGES[cruise.status],
      cruiseStatus: cruise.status,
    };
  }
  let targetSpeed: number = GAME.maxSpeed;
  const brakePressure = getBrakePressure(control);
  const manualControl =
    control.accelerating !== undefined || control.braking !== undefined || brakePressure > 0;

  if (!control.active) targetSpeed = 0;
  const assistMessage = describeAssist(control);
  const autoBraking = !control.active && currentSpeed > 0.35;
  let acceleration: number;

  if (manualControl && control.active) {
    if (brakePressure > 0) {
      // Partial pressure slows the car to a speed and holds it there rather
      // than eventually stopping: the half brake settles at HALF_BRAKE_KPH,
      // and only full pressure (open palms or the brake key) produces zero.
      const brakeSpeedCap = fromKph(HALF_BRAKE_KPH) * 2 * (1 - brakePressure);
      targetSpeed = Math.min(targetSpeed, currentSpeed, brakeSpeedCap);
    } else if (!control.accelerating) {
      targetSpeed = 0;
    }
    acceleration =
      brakePressure > 0
        ? lerp(GAME.coastDeceleration, GAME.serviceBrake, brakePressure)
        : control.accelerating
          ? driveAcceleration(currentSpeed)
          : GAME.coastDeceleration;
  } else {
    acceleration = targetSpeed > currentSpeed ? driveAcceleration(currentSpeed) : GAME.serviceBrake;
  }

  const braking = manualControl && control.active && brakePressure > 0;
  return { targetSpeed, acceleration, autoBraking, braking, assistMessage };
}

/**
 * Reverse gear: keep holding the full brake once the car has stopped (for the
 * input's delay) to back up. Driving on while rolling backward brakes to a
 * stop first, like an automatic gearbox. Returns null when the forward plan applies.
 */
function planReverse(
  control: ControlInput,
  currentSpeed: number,
  reverseHoldSeconds: number,
): SpeedPlan | null {
  const gear = control.reverseGear;
  const fullBrake = control.active && getBrakePressure(control) >= 1;
  if (gear && fullBrake && currentSpeed <= GAME.reverseEngageSpeed) {
    if (reverseHoldSeconds >= gear.delaySeconds) {
      return {
        targetSpeed: -gear.maxSpeed,
        acceleration: GAME.reverseAcceleration,
        autoBraking: false,
        braking: false,
        assistMessage: 'REVERSING',
      };
    }
    if (Math.abs(currentSpeed) < STOPPED_SPEED) {
      return {
        targetSpeed: 0,
        acceleration: GAME.serviceBrake,
        autoBraking: false,
        braking: true,
        assistMessage: 'HOLD TO REVERSE',
      };
    }
  }
  if (currentSpeed >= REVERSE_ROLL_SPEED) return null;
  if (!control.active) {
    return {
      targetSpeed: 0,
      acceleration: GAME.serviceBrake,
      autoBraking: true,
      braking: false,
      assistMessage: describeAssist(control),
    };
  }
  // Hand controls always drive on (`accelerating` is undefined); keyboard
  // drivers press the accelerator. Either way the car stops before going forward.
  const drivingOn = control.accelerating !== false;
  return {
    targetSpeed: 0,
    acceleration: drivingOn ? GAME.serviceBrake : GAME.coastDeceleration,
    autoBraking: false,
    braking: drivingOn,
    assistMessage: drivingOn ? 'BRAKING 100%' : 'COASTING',
  };
}

function getBrakePressure(control: ControlInput): number {
  if (control.brakePressure !== undefined) return clamp(control.brakePressure, 0, 1);
  return control.braking ? 1 : 0;
}

function describeAssist(control: ControlInput): string {
  const brakePressure = getBrakePressure(control);
  const manualControl =
    control.accelerating !== undefined || control.braking !== undefined || brakePressure > 0;
  if (!control.active) return 'HANDS LOST · AUTO BRAKE';
  if (manualControl && brakePressure > 0) return `BRAKING ${Math.round(brakePressure * 100)}%`;
  if (manualControl && control.accelerating) return 'ACCELERATING';
  return manualControl ? 'COASTING' : 'CRUISING';
}
