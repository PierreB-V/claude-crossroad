import { ARM_INDEX } from './geometry';
import type { ArmId, Turn } from './types';

export interface MovementLike {
  from: ArmId;
  to: ArmId;
  turn: Turn;
  exitLanes: readonly number[];
}

/**
 * Whether two movements may not be green at the same time (protected movements only).
 *
 * - Same origin arm: never (they diverge).
 * - Same target arm sharing an exit lane: conflict (merge).
 * - Opposite arms: only left vs. straight cross; opposing lefts pass each other.
 * - Perpendicular arms: paths cross unless one of them is a right turn.
 */
export function movementsConflict(a: MovementLike, b: MovementLike): boolean {
  if (a.from === b.from) return false;
  if (a.to === b.to && a.exitLanes.some((l) => b.exitLanes.includes(l))) return true;
  const rel = (ARM_INDEX[b.from] - ARM_INDEX[a.from] + 4) % 4;
  if (rel === 2) return (a.turn === 'L' && b.turn === 'S') || (a.turn === 'S' && b.turn === 'L');
  return a.turn !== 'R' && b.turn !== 'R';
}

export function conflictMatrix(movements: readonly MovementLike[]): boolean[][] {
  return movements.map((a) => movements.map((b) => movementsConflict(a, b)));
}
