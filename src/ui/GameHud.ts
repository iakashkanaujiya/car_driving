import type { GameSnapshot } from '../game/types';
import { byId } from './dom';

/** Updates the in-run HUD without exposing its DOM structure to the game loop. */
export class GameHud {
  private readonly root = byId<HTMLElement>('hud');
  private readonly speed = byId<HTMLElement>('speed');
  private readonly speedFill = byId<HTMLElement>('speed-fill');
  private readonly distance = byId<HTMLElement>('distance');
  private readonly overtakes = byId<HTMLElement>('overtakes');
  private readonly score = byId<HTMLElement>('score');
  private readonly assist = byId<HTMLElement>('assist').querySelector<HTMLElement>('span')!;
  private readonly steering = byId<HTMLElement>('steer-indicator');

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  update(snapshot: GameSnapshot, steering: number): void {
    this.speed.textContent = Math.round(snapshot.speedKph).toString().padStart(3, '0');
    this.speedFill.style.width = `${Math.min(100, snapshot.speedKph / 1.62)}%`;
    this.distance.innerHTML = `${(snapshot.distance / 1000).toFixed(2)} <small>KM</small>`;
    this.overtakes.textContent = snapshot.overtakes.toString();
    this.score.textContent = snapshot.score.toString().padStart(6, '0');
    this.assist.textContent = snapshot.assistMessage;
    this.steering.style.left = `${50 + steering * 46}%`;
  }
}
