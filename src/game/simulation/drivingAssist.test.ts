import { describe, expect, it } from 'vitest';
import { GAME } from '../config';
import { createSpeedPlan } from './drivingAssist';

describe('driving assistance', () => {
  it('never slows the car for traffic or curves on its own', () => {
    const handCruise = createSpeedPlan({ steering: 0, confidence: 1, active: true }, 25);
    const keyboard = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, accelerating: true, braking: false },
      25,
    );

    for (const plan of [handCruise, keyboard]) {
      expect(plan.targetSpeed).toBe(GAME.maxSpeed);
      expect(plan.acceleration).toBe(GAME.acceleration);
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
    const partial = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 0.5 },
      25,
    );
    const full = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 1 },
      25,
    );

    expect(partial.targetSpeed).toBe(GAME.maxSpeed * 0.5);
    expect(partial.acceleration).toBeGreaterThan(GAME.coastDeceleration);
    expect(partial.acceleration).toBeLessThan(GAME.serviceBrake);
    expect(partial.assistMessage).toBe('BRAKING 50%');
    expect(full.targetSpeed).toBe(0);
    expect(full.acceleration).toBe(GAME.serviceBrake);
  });

  it('does not stop or accelerate a car already below the partial-brake speed cap', () => {
    const plan = createSpeedPlan(
      { steering: 0, confidence: 1, active: true, braking: true, brakePressure: 0.5 },
      10,
    );

    expect(plan.targetSpeed).toBe(10);
  });
});
