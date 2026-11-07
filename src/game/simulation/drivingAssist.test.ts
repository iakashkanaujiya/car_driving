import { describe, expect, it } from 'vitest';
import {
  driveAcceleration,
  fromKph,
  GAME,
  HALF_BRAKE_KPH,
  HAND_REVERSE,
  KEYBOARD_REVERSE,
  toKph,
} from '../config';
import { damp } from '../math';
import { createSpeedPlan, updateReverseHold } from './drivingAssist';

describe('driving assistance', () => {
  it('never slows the car for traffic or curves on its own', () => {
    const handCruise = createSpeedPlan({ steering: 0, confidence: 1, active: true }, 25);
    const keyboard = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, accelerating: true, braking: false },
      25,
    );

    for (const plan of [handCruise, keyboard]) {
      expect(plan.targetSpeed).toBe(GAME.maxSpeed);
      expect(plan.acceleration).toBe(driveAcceleration(25));
      expect(plan.autoBraking).toBe(false);
    }
    expect(handCruise.assistMessage).toBe('CRUISING');
    expect(keyboard.assistMessage).toBe('ACCELERATING');
  });

  it('coasts down when keyboard drivers release the accelerator', () => {
    const plan = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, accelerating: false, braking: false },
      25,
    );

    expect(plan.targetSpeed).toBe(0);
    expect(plan.acceleration).toBe(GAME.coastDeceleration);
    expect(plan.autoBraking).toBe(false);
    expect(plan.assistMessage).toBe('COASTING');
  });

  it('auto-brakes when hand controls become inactive', () => {
    const plan = createSpeedPlan({ steering: 0, confidence: 0, active: false }, 20);

    expect(plan.targetSpeed).toBe(0);
    expect(plan.acceleration).toBe(GAME.serviceBrake);
    expect(plan.autoBraking).toBe(true);
    expect(plan.assistMessage).toBe('HANDS LOST · AUTO BRAKE');
  });

  it('scales braking force with the requested brake level', () => {
    const fast = GAME.maxSpeed * 0.8;
    const partial = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 0.5 },
      fast,
    );
    const full = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 1 },
      fast,
    );

    expect(partial.targetSpeed).toBeCloseTo(fromKph(HALF_BRAKE_KPH), 9);
    expect(HALF_BRAKE_KPH).toBe(40);
    expect(partial.acceleration).toBeGreaterThan(GAME.coastDeceleration);
    expect(partial.acceleration).toBeLessThan(GAME.serviceBrake);
    expect(partial.assistMessage).toBe('BRAKING 50%');
    expect(full.targetSpeed).toBe(0);
    expect(full.acceleration).toBe(GAME.serviceBrake);
  });

  it('slows a fast car to 40 km/h and holds it there on the half brake', () => {
    const thumbs = { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 0.5 };
    let speed = fromKph(120);
    const dt = 1 / 60;
    for (let step = 0; step < 60 * 8; step += 1) {
      const { targetSpeed, acceleration } = createSpeedPlan(thumbs, speed);
      speed = damp(
        speed,
        targetSpeed,
        acceleration / Math.max(8, Math.abs(targetSpeed - speed)),
        dt,
      );
    }
    expect(toKph(speed)).toBeGreaterThan(39);
    expect(toKph(speed)).toBeLessThan(41.5);
  });

  describe('keyboard reverse', () => {
    const keys = (accelerating: boolean, braking: boolean) => ({
      steering: 0,
      confidence: 1,
      active: true,
      accelerating,
      braking,
      reverseGear: KEYBOARD_REVERSE,
    });

    it('brakes a moving car to a stop before reversing', () => {
      const plan = createSpeedPlan(keys(false, true), 20);
      expect(plan.targetSpeed).toBe(0);
      expect(plan.acceleration).toBe(GAME.serviceBrake);
      expect(plan.braking).toBe(true);
    });

    it('reverses as soon as the car stops with the brake held', () => {
      for (const speed of [0, -4]) {
        const plan = createSpeedPlan(keys(false, true), speed);
        expect(plan.targetSpeed).toBe(-KEYBOARD_REVERSE.maxSpeed);
        expect(plan.acceleration).toBe(GAME.reverseAcceleration);
        expect(plan.braking).toBe(false);
        expect(plan.assistMessage).toBe('REVERSING');
      }
    });

    it('brakes out of reverse on the accelerator, then drives forward', () => {
      const stopping = createSpeedPlan(keys(true, false), -6);
      expect(stopping.targetSpeed).toBe(0);
      expect(stopping.acceleration).toBe(GAME.serviceBrake);
      expect(stopping.braking).toBe(true);
      const forward = createSpeedPlan(keys(true, false), 0);
      expect(forward.targetSpeed).toBe(GAME.maxSpeed);
    });

    it('coasts to a stop when both pedals are released in reverse', () => {
      const plan = createSpeedPlan(keys(false, false), -6);
      expect(plan.targetSpeed).toBe(0);
      expect(plan.acceleration).toBe(GAME.coastDeceleration);
      expect(plan.assistMessage).toBe('COASTING');
    });
  });

  describe('hand reverse', () => {
    const palms = {
      steering: 0,
      confidence: 1,
      active: true,
      braking: true,
      brakePressure: 1,
      reverseGear: HAND_REVERSE,
    };
    const fists = { steering: 0, confidence: 1, active: true, reverseGear: HAND_REVERSE };

    it('waits at a standstill before backing up slowly', () => {
      const waiting = createSpeedPlan(palms, 0, {
        reverseHoldSeconds: HAND_REVERSE.delaySeconds - 0.1,
      });
      expect(waiting.targetSpeed).toBe(0);
      expect(waiting.assistMessage).toBe('HOLD TO REVERSE');
      expect(waiting.braking).toBe(true);

      const reversing = createSpeedPlan(palms, 0, {
        reverseHoldSeconds: HAND_REVERSE.delaySeconds,
      });
      expect(reversing.targetSpeed).toBe(-HAND_REVERSE.maxSpeed);
      expect(HAND_REVERSE.maxSpeed).toBeLessThan(KEYBOARD_REVERSE.maxSpeed);
    });

    it('only counts the hold once the car has stopped under a full brake', () => {
      let held = 0;
      held = updateReverseHold(held, palms, 12, 0.5);
      expect(held).toBe(0);
      held = updateReverseHold(held, palms, 0, 0.5);
      held = updateReverseHold(held, palms, 0, 0.5);
      expect(held).toBe(1);
      // Thumbs-up is a half brake and never reverses.
      const thumbs = { ...palms, brakePressure: 0.5 };
      expect(updateReverseHold(held, thumbs, 0, 0.5)).toBe(0);
      expect(updateReverseHold(held, { ...palms, active: false }, 0, 0.5)).toBe(0);
    });

    it('stops a reversing car when the fists come back, then drives forward', () => {
      const stopping = createSpeedPlan(fists, -4);
      expect(stopping.targetSpeed).toBe(0);
      expect(stopping.acceleration).toBe(GAME.serviceBrake);
      expect(stopping.braking).toBe(true);
      expect(createSpeedPlan(fists, 0).targetSpeed).toBe(GAME.maxSpeed);
    });

    it('auto-brakes a reversing car when the hands are lost', () => {
      const plan = createSpeedPlan({ steering: 0, confidence: 0, active: false }, -4);
      expect(plan.targetSpeed).toBe(0);
      expect(plan.acceleration).toBe(GAME.serviceBrake);
      expect(plan.autoBraking).toBe(true);
    });
  });

  it('never reverses for an input without a reverse gear', () => {
    const plan = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 1 },
      0,
      { reverseHoldSeconds: 5 },
    );
    expect(plan.targetSpeed).toBe(0);
  });

  it('does not stop or accelerate a car already below the partial-brake speed cap', () => {
    const plan = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 0.5 },
      10,
    );

    expect(plan.targetSpeed).toBe(10);
  });
});
