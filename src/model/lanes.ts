import { TURNS, type Turn } from './types';

const TURN_RANK: Record<Turn, number> = { L: 0, S: 1, R: 2 };

/** Default turn assignment for `n` inbound lanes given the turns that are possible on this arm. */
export function defaultLaneTurns(available: readonly Turn[], n: number): Turn[][] {
  const has = (t: Turn) => available.includes(t);
  if (n <= 0 || available.length === 0) return Array.from({ length: Math.max(n, 0) }, () => []);
  if (n === 1) return [TURNS.filter(has)];

  const lanes: Turn[][] = Array.from({ length: n }, () => []);
  if (has('S')) {
    for (const lane of lanes) lane.push('S');
    // From 3 lanes on, the leftmost becomes a dedicated left-turn lane.
    if (has('L')) lanes[0] = n >= 3 ? ['L'] : ['L', 'S'];
    if (has('R')) lanes[n - 1].push('R');
  } else if (has('L') && has('R')) {
    // T-junction stem: left half turns left, right half turns right.
    const leftCount = Math.ceil(n / 2);
    lanes.forEach((lane, i) => lane.push(i < leftCount ? 'L' : 'R'));
  } else {
    for (const lane of lanes) lane.push(available[0]);
  }
  return lanes;
}

/** True when turns are ordered L → S → R from the leftmost to the rightmost lane (no crossing). */
export function lanesAreOrdered(laneTurns: readonly Turn[][]): boolean {
  let maxSoFar = -1;
  for (const turns of laneTurns) {
    if (turns.length === 0) continue;
    const ranks = turns.map((t) => TURN_RANK[t]);
    if (Math.min(...ranks) < maxSoFar) return false;
    maxSoFar = Math.max(maxSoFar, ...ranks);
  }
  return true;
}

/**
 * Exit lane on the target arm for the `rank`-th (from the left) of `count` lanes performing `turn`.
 * Left and straight movements fill outbound lanes from the inside, right turns from the outside.
 */
export function exitLaneFor(turn: Turn, rank: number, count: number, outLanes: number): number {
  if (turn === 'R') return Math.max(0, outLanes - count + rank);
  return Math.min(rank, outLanes - 1);
}
