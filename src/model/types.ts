export type ArmId = 'N' | 'E' | 'S' | 'W';
export type Turn = 'L' | 'S' | 'R';
export type MovementId = `${ArmId}${Turn}`;

/** Clockwise order as seen on screen (y axis points down / south). */
export const ARMS: readonly ArmId[] = ['N', 'E', 'S', 'W'];
/** Ordered left to right, which is also the required lane order. */
export const TURNS: readonly Turn[] = ['L', 'S', 'R'];

export interface ArmConfig {
  enabled: boolean;
  inLanes: number;
  outLanes: number;
  /** Allowed turns per inbound lane; index 0 is the leftmost lane (next to the centre line). */
  laneTurns: Turn[][];
  /** Arrival rate per turn, in vehicles per hour. */
  demand: Record<Turn, number>;
}

export interface IntersectionConfig {
  name: string;
  arms: Record<ArmId, ArmConfig>;
}

export const MIN_LANES = 1;
export const MAX_LANES = 4;
