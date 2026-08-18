export type GamePhase = 'loading' | 'permission' | 'calibrating' | 'ready' | 'playing' | 'paused' | 'crashed';
export type ControlMode = 'hands' | 'keyboard';
export type CarStyle = 'real' | 'cartoon';

export interface ControlInput {
  steering: number;
  confidence: number;
  active: boolean;
}

export interface GameSnapshot {
  speedKph: number;
  distance: number;
  overtakes: number;
  score: number;
  phase: GamePhase;
  assistMessage: string;
}
