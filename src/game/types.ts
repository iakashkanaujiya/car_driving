export type GamePhase =
  'loading' | 'permission' | 'calibrating' | 'ready' | 'playing' | 'paused' | 'crashed';
export type ControlMode = 'hands' | 'keyboard';

/** How an input reaches reverse: hold the full brake at a standstill. */
export interface ReverseGear {
  /** Seconds the full brake must stay held after the car stops. */
  delaySeconds: number;
  /** Top reverse speed in world units per second. */
  maxSpeed: number;
}

export interface ControlInput {
  steering: number;
  confidence: number;
  active: boolean;
  accelerating?: boolean;
  braking?: boolean;
  /** Normalized analog brake pressure. Omitted when the brake is released. */
  brakePressure?: number;
  /** Present when this input can reverse. */
  reverseGear?: ReverseGear;
}

export interface GameSnapshot {
  /** Speed over the ground, forward or in reverse. */
  speedKph: number;
  distance: number;
  overtakes: number;
  score: number;
  phase: GamePhase;
  assistMessage: string;
}
