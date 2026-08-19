import type { ControlInput } from '../game/types';

export class KeyboardController {
  private left = false;
  private right = false;
  private accelerating = false;
  private braking = false;

  constructor(
    private readonly eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  ) {
    this.eventTarget.addEventListener('keydown', this.onKeyDown);
    this.eventTarget.addEventListener('keyup', this.onKeyUp);
    this.eventTarget.addEventListener('blur', this.reset);
  }

  getInput(): ControlInput {
    return {
      steering: Number(this.right) - Number(this.left),
      confidence: 1,
      active: this.left || this.right || this.accelerating || this.braking,
      accelerating: this.accelerating,
      braking: this.braking,
    };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.left = true;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.right = true;
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.accelerating = true;
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.braking = true;
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.left = false;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.right = false;
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.accelerating = false;
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.braking = false;
  };

  private reset = (): void => {
    this.left = false;
    this.right = false;
    this.accelerating = false;
    this.braking = false;
  };

  dispose(): void {
    this.eventTarget.removeEventListener('keydown', this.onKeyDown);
    this.eventTarget.removeEventListener('keyup', this.onKeyUp);
    this.eventTarget.removeEventListener('blur', this.reset);
  }
}
