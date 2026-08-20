export type GamePhase =
  'loading' | 'permission' | 'calibrating' | 'ready' | 'playing' | 'paused' | 'crashed';
export type ControlMode = 'hands' | 'keyboard';

export interface ControlInput {
  steering: number;
  confidence: number;
  active: boolean;
  accelerating?: boolean;
  braking?: boolean;
  /** Normalized analog brake pressure. Omitted when the brake is released. */
  brakePressure?: number;
}

export interface GameSnapshot {
  speedKph: number;
  distance: number;
  overtakes: number;
  score: number;
  phase: GamePhase;
  assistMessage: string;
}
