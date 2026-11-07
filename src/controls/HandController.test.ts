import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandController } from './HandController';
import type { HandCommand } from './HandController';
import type { HandPoint, HandTrackingResult } from './handWorkerTypes';

/** A fist around (0.5, 0.7) in camera space, optionally with the thumb raised or a V sign. */
function hand(pose: 'fist' | 'thumb' | 'victory', offsetX: number): HandPoint[] {
  const points = Array.from({ length: 21 }, (): HandPoint => ({ x: 0.5, y: 0.68, z: 0 }));
  points[0] = { x: 0.5, y: 0.8, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[9] = { x: 0.48, y: 0.58, z: 0 };
  points[13] = { x: 0.54, y: 0.6, z: 0 };
  points[17] = { x: 0.6, y: 0.64, z: 0 };
  points[2] = { x: 0.42, y: 0.66, z: 0 };
  points[3] = { x: 0.44, y: 0.64, z: 0 };
  points[4] = { x: 0.48, y: 0.65, z: 0 };
  if (pose === 'thumb') {
    points[2] = { x: 0.4, y: 0.66, z: 0 };
    points[3] = { x: 0.4, y: 0.46, z: 0 };
    points[4] = { x: 0.4, y: 0.28, z: 0 };
  } else if (pose === 'victory') {
    points[8] = { x: 0.38, y: 0.26, z: 0 };
    points[12] = { x: 0.5, y: 0.2, z: 0 };
  }
  return points.map((point) => ({ ...point, x: point.x + offsetX }));
}

/** Camera space is not mirrored: the player's right hand has the smaller x. */
function frame(right: 'fist' | 'thumb' | 'victory', left: 'fist' | 'thumb' | 'victory') {
  return {
    landmarks: [hand(right, -0.25), hand(left, 0.25)],
    handednessScores: [0.95, 0.95],
  } satisfies HandTrackingResult;
}

describe('HandController cruise gestures', () => {
  afterEach(() => vi.restoreAllMocks());

  function calibratedController() {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const commands: HandCommand[] = [];
    const controller = new HandController(
      {} as HTMLVideoElement,
      {} as HTMLCanvasElement,
      () => undefined,
      (command) => commands.push(command),
    );
    const consume = (result: HandTrackingResult, ms = 50) => {
      now += ms;
      (controller as unknown as { consumeResult(result: HandTrackingResult): void }).consumeResult(
        result,
      );
    };
    controller.beginCalibration();
    for (let sample = 0; sample < 45; sample += 1) consume(frame('fist', 'fist'));
    return { controller, commands, consume };
  }

  it('toggles adaptive cruise once per held V sign, and keeps steering meanwhile', () => {
    const { controller, commands, consume } = calibratedController();
    for (let step = 0; step < 30; step += 1) consume(frame('victory', 'victory'));
    expect(commands).toEqual(['cruise-toggle']);
    // The V sign still counts as holding the wheel, without braking.
    expect(controller.getInput()).toMatchObject({ active: true, brakePressure: undefined });

    consume(frame('fist', 'fist'));
    for (let step = 0; step < 20; step += 1) consume(frame('victory', 'victory'));
    expect(commands).toEqual(['cruise-toggle', 'cruise-toggle']);
  });

  it('steps the set speed with one raised thumb, repeating while it is held', () => {
    const { commands, consume } = calibratedController();
    for (let step = 0; step < 24; step += 1) consume(frame('thumb', 'fist'));
    expect(commands).toEqual(['cruise-faster', 'cruise-faster']);
    consume(frame('fist', 'fist'));
    for (let step = 0; step < 10; step += 1) consume(frame('fist', 'thumb'));
    expect(commands.at(-1)).toBe('cruise-slower');
  });

  it('keeps both thumbs up as the half brake, not a speed change', () => {
    const { controller, commands, consume } = calibratedController();
    for (let step = 0; step < 20; step += 1) consume(frame('thumb', 'thumb'));
    expect(commands).toEqual([]);
    expect(controller.getInput().brakePressure).toBe(0.5);
  });
});
