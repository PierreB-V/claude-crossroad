import type { CompiledIntersection } from '../model/intersection';
import { ALL_RED, MAX_GREEN, MIN_GREEN, YELLOW, type SignalPlan } from '../sim/signal';

/** Saturation flow of one lane, veh/h (measured on the simulator: ~1660). */
export const SATURATION_FLOW = 1650;
/** Turning vehicles discharge more slowly. */
const TURN_FACTOR = { L: 0.9, S: 1, R: 0.85 } as const;
/** Start-up lost time per phase, s. */
const STARTUP_LOST = 2;
/** Lost time per phase: start-up loss + all-red (yellow is mostly used). */
export const LOST_TIME_PER_PHASE = STARTUP_LOST + ALL_RED;
const MAX_CYCLE = 150;
/** Cap on the number of phases considered when searching phase combinations. */
const MAX_PHASES = 4;

export interface WebsterResult {
  plan: SignalPlan;
  /** Flow ratio of each movement (demand / saturation flow of its lanes). */
  flowRatios: number[];
  /** Critical flow ratio per phase. */
  phaseRatios: number[];
  /** Sum of critical flow ratios. */
  Y: number;
  /** Total lost time per cycle, s. */
  L: number;
  /** Webster optimal cycle length (before clamping), s. */
  optimalCycle: number;
  cycle: number;
  /** Y ≥ 1: no fixed-time plan can serve the demand. */
  oversaturated: boolean;
}

/** Demand / capacity of each movement, splitting demand evenly over its lanes. */
export function flowRatios(ix: CompiledIntersection): number[] {
  const laneFlow = new Map<string, number>();
  for (const m of ix.movements) {
    for (const lane of m.lanes) {
      const key = `${m.from}${lane}`;
      laneFlow.set(key, (laneFlow.get(key) ?? 0) + m.demand / m.lanes.length / TURN_FACTOR[m.turn]);
    }
  }
  return ix.movements.map((m) => Math.max(0, ...m.lanes.map((l) => laneFlow.get(`${m.from}${l}`)! / SATURATION_FLOW)));
}

/**
 * Critical ratio of each phase. A movement served by several phases shares its
 * requirement between them.
 */
function phaseRatios(phases: number[][], ratios: number[]): number[] {
  const servedBy = new Map<number, number>();
  for (const set of phases) for (const m of set) servedBy.set(m, (servedBy.get(m) ?? 0) + 1);
  return phases.map((set) => Math.max(0, ...set.map((m) => ratios[m] / servedBy.get(m)!)));
}

function* combinations(n: number, k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i < n; i++) {
    acc.push(i);
    yield* combinations(n, k, i + 1, acc);
    acc.pop();
  }
}

/**
 * Classic Webster fixed-time plan: picks the combination of candidate phases (≤ 4) that
 * serves every movement with the smallest critical flow ratio sum Y, then
 * C₀ = (1.5 L + 5) / (1 − Y) and greens proportional to each phase's critical ratio.
 */
export function websterPlan(ix: CompiledIntersection): WebsterResult {
  const ratios = flowRatios(ix);
  const needed = ix.movements.filter((m) => m.demand > 0).map((m) => m.index);

  // Rank combinations by Webster's cycle (it accounts for both Y and the lost time of extra
  // phases); when every combination is oversaturated, by Y.
  let bestPhases: number[][] = [];
  let bestScore = Infinity;
  for (let k = 1; k <= Math.min(MAX_PHASES, ix.phaseSets.length); k++) {
    for (const combo of combinations(ix.phaseSets.length, k)) {
      const phases = combo.map((i) => ix.phaseSets[i]);
      if (!needed.every((m) => phases.some((set) => set.includes(m)))) continue;
      const Y = phaseRatios(phases, ratios).reduce((a, b) => a + b, 0);
      const score = Y < 1 ? (1.5 * k * LOST_TIME_PER_PHASE + 5) / (1 - Y) : 1e6 + Y;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        bestPhases = phases;
      }
    }
  }
  if (bestPhases.length === 0) bestPhases = ix.phaseSets.slice(0, 1);

  const crit = phaseRatios(bestPhases, ratios);
  const Y = crit.reduce((a, b) => a + b, 0);
  const n = bestPhases.length;
  const L = n * LOST_TIME_PER_PHASE;
  const oversaturated = Y >= 1;
  const optimalCycle = oversaturated ? Infinity : (1.5 * L + 5) / (1 - Y);
  const minCycle = n * (MIN_GREEN + YELLOW + ALL_RED);
  const cycle = Math.min(MAX_CYCLE, Math.max(minCycle, optimalCycle));

  // Effective green = green + yellow − start-up loss, shared in proportion to critical ratios.
  const effective = cycle - L;
  const plan: SignalPlan = {
    phases: bestPhases.map((set, k) => {
      const g = Y > 0 ? (effective * crit[k]) / Y : effective / n;
      const green = Math.round(g - YELLOW + STARTUP_LOST);
      return {
        movements: set.map((m) => ix.movements[m].id),
        green: Math.min(MAX_GREEN, Math.max(MIN_GREEN, green)),
      };
    }),
  };

  return { plan, flowRatios: ratios, phaseRatios: crit, Y, L, optimalCycle, cycle, oversaturated };
}
