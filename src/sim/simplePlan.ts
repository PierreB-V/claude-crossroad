import type { CompiledIntersection } from '../model/intersection';
import type { SignalPlan } from './signal';

/**
 * Naive fixed-time plan: greedily picks candidate phases until every movement is
 * served, each with the same green time. Used as the hand-written starting plan.
 */
export function simplePlan(ix: CompiledIntersection, green = 20): SignalPlan {
  const demandOf = (set: number[], open: Set<number>) =>
    set.reduce((sum, m) => sum + (open.has(m) ? ix.movements[m].demand : 0), 0);
  const open = new Set(ix.movements.map((m) => m.index));
  const phases: SignalPlan['phases'] = [];
  while (open.size > 0) {
    let best = ix.phaseSets[0];
    let bestScore = -1;
    for (const set of ix.phaseSets) {
      const covered = set.filter((m) => open.has(m)).length;
      const score = covered * 1e6 + demandOf(set, open);
      if (score > bestScore) {
        best = set;
        bestScore = score;
      }
    }
    if (!best || bestScore <= 0) break;
    best.forEach((m) => open.delete(m));
    phases.push({ movements: best.map((m) => ix.movements[m].id), green });
  }
  return { phases };
}
