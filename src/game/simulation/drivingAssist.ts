import { GAME } from '../config';
import { clamp, lerp } from '../math';
import type { ControlInput } from '../types';

export interface SpeedPlan {
  targetSpeed: number;
  acceleration: number;
  /** The car is stopping on its own because hand tracking lost the player. */
  autoBraking: boolean;
  assistMessage: string;
}

/**
 * Converts player intent into a deterministic speed plan. Traffic and curves
 * never slow the car: avoiding them is up to the player. The only automatic
 * braking is the stop when hand controls go inactive.
 */
export function createSpeedPlan(control: ControlInput, currentSpeed: number): SpeedPlan {
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
      // Partial pressure behaves as a speed limiter rather than eventually
      // stopping the car. Only the full-brake gesture produces zero.
      const brakeSpeedCap = GAME.maxSpeed * (1 - brakePressure);
      targetSpeed = Math.min(targetSpeed, currentSpeed, brakeSpeedCap);
    } else if (!control.accelerating) {
      targetSpeed = 0;
    }
    acceleration =
      brakePressure > 0
        ? lerp(GAME.coastDeceleration, GAME.serviceBrake, brakePressure)
        : control.accelerating
          ? GAME.acceleration
          : GAME.coastDeceleration;
  } else {
    acceleration = targetSpeed > currentSpeed ? GAME.acceleration : GAME.serviceBrake;
  }

  return { targetSpeed, acceleration, autoBraking, assistMessage };
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
