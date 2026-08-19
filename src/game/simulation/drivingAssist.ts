import { GAME, laneOffsets } from '../config';
import { clamp } from '../math';
import type { ControlInput } from '../types';

export interface TrafficAwarenessCar {
  distance: number;
  lane: number;
  laneOffset: number;
  speed: number;
  direction: 1 | -1;
}

export interface TrafficThreat {
  targetSpeed: number;
  leadDistance: number;
  leadIsIncoming: boolean;
}

export interface SpeedPlan extends TrafficThreat {
  acceleration: number;
  safetyBraking: boolean;
  assistMessage: string;
}

/** Finds the nearest relevant vehicle and derives the safety-limited speed. */
export function scanTraffic(
  cars: readonly TrafficAwarenessCar[],
  playerDistance: number,
  playerLateral: number,
  curveSpeedLimit: number,
): TrafficThreat {
  let targetSpeed = curveSpeedLimit;
  let leadDistance = Number.POSITIVE_INFINITY;
  let leadIsIncoming = false;

  for (const car of cars) {
    const gap = car.distance - playerDistance;
    const laneGap = Math.abs(laneOffsets[car.lane] + car.laneOffset - playerLateral);
    if (gap <= 0 || gap >= leadDistance || laneGap >= 2.35) continue;

    leadDistance = gap;
    leadIsIncoming = car.direction === -1;
    if (car.direction === -1 && gap < 95) {
      targetSpeed = Math.min(targetSpeed, GAME.maxSpeed * clamp((gap - 13) / 55, 0, 1));
    } else if (car.direction === 1 && gap < 58) {
      targetSpeed = Math.min(targetSpeed, car.speed * clamp((gap - 7) / 28, 0, 1));
    }
  }

  return { targetSpeed, leadDistance, leadIsIncoming };
}

/** Converts player intent and traffic awareness into a deterministic speed plan. */
export function createSpeedPlan(
  control: ControlInput,
  currentSpeed: number,
  curveSpeedLimit: number,
  threat: TrafficThreat,
): SpeedPlan {
  let { targetSpeed } = threat;
  const { leadDistance, leadIsIncoming } = threat;
  const manualControl = control.accelerating !== undefined || control.braking !== undefined;

  if (!control.active) targetSpeed = 0;
  const assistMessage = describeAssist(control, curveSpeedLimit, leadDistance, leadIsIncoming);
  const safetyBraking = targetSpeed < currentSpeed - 0.35;
  let acceleration: number;

  if (manualControl && control.active) {
    if (control.braking || !control.accelerating) targetSpeed = 0;
    acceleration = safetyBraking
      ? isEmergency(leadDistance, leadIsIncoming)
        ? GAME.emergencyBrake
        : GAME.serviceBrake
      : control.braking
        ? GAME.serviceBrake
        : control.accelerating
          ? GAME.acceleration
          : GAME.coastDeceleration;
  } else {
    acceleration =
      targetSpeed > currentSpeed
        ? GAME.acceleration
        : isEmergency(leadDistance, leadIsIncoming)
          ? GAME.emergencyBrake
          : GAME.serviceBrake;
  }

  return {
    targetSpeed,
    leadDistance,
    leadIsIncoming,
    acceleration,
    safetyBraking,
    assistMessage,
  };
}

function isEmergency(leadDistance: number, leadIsIncoming: boolean): boolean {
  return leadDistance < 15 || (leadIsIncoming && leadDistance < 32);
}

function describeAssist(
  control: ControlInput,
  curveSpeedLimit: number,
  leadDistance: number,
  leadIsIncoming: boolean,
): string {
  const manualControl = control.accelerating !== undefined || control.braking !== undefined;
  if (!control.active) return 'HANDS LOST · AUTO BRAKE';
  if (leadIsIncoming && leadDistance < 70) {
    return leadDistance < 28 ? 'ONCOMING · EMERGENCY BRAKE' : 'ONCOMING VEHICLE';
  }
  if (leadDistance < 32) return leadDistance < 15 ? 'EMERGENCY BRAKE' : 'TRAFFIC ASSIST';
  if (curveSpeedLimit < GAME.maxSpeed - 4) return 'CURVE ASSIST';
  if (manualControl && control.braking) return 'BRAKING';
  if (manualControl && control.accelerating) return 'ACCELERATING';
  return manualControl ? 'COASTING' : 'CRUISING';
}
