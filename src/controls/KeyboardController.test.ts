import { describe, expect, it } from 'vitest';
import { KeyboardController } from './KeyboardController';

class FakeKeyboardTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: 'keydown' | 'keyup', code: string): void {
    const event = { code } as KeyboardEvent;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  blur(): void {
    this.listeners.get('blur')?.forEach((listener) => listener(new Event('blur')));
  }
}

describe('KeyboardController', () => {
  it('maps acceleration, braking, and steering keys independently', () => {
    const target = new FakeKeyboardTarget();
    const keyboard = new KeyboardController(target as unknown as Window);

    target.dispatch('keydown', 'KeyW');
    target.dispatch('keydown', 'ArrowLeft');
    expect(keyboard.getInput()).toMatchObject({
      steering: -1,
      accelerating: true,
      braking: false,
    });

    target.dispatch('keydown', 'KeyS');
    expect(keyboard.getInput().braking).toBe(true);

    target.dispatch('keyup', 'KeyW');
    target.dispatch('keyup', 'ArrowLeft');
    expect(keyboard.getInput()).toMatchObject({
      steering: 0,
      accelerating: false,
      braking: true,
    });

    keyboard.dispose();
  });

  it('clears held controls when the window loses focus', () => {
    const target = new FakeKeyboardTarget();
    const keyboard = new KeyboardController(target as unknown as Window);
    target.dispatch('keydown', 'ArrowUp');
    target.dispatch('keydown', 'ArrowRight');

    target.blur();

    expect(keyboard.getInput()).toMatchObject({
      steering: 0,
      accelerating: false,
      braking: false,
      active: false,
    });
    keyboard.dispose();
  });
});
