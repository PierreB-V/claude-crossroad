import type { CompiledIntersection } from '../model/intersection';
import type { Rng } from '../sim/rng';
import { MAX_GREEN, MIN_GREEN, type SignalPlan } from '../sim/signal';

export const MIN_PHASES = 2;
export const MAX_PHASES = 6;

/** One phase of the plan: which candidate movement set is green, and for how long. */
export interface Gene {
  /** Index into `CompiledIntersection.phaseSets`. */
  set: number;
  /** Green time, s. */
  green: number;
}

export type Genome = Gene[];

export function toPlan(ix: CompiledIntersection, genome: Genome): SignalPlan {
  return {
    phases: genome.map((g) => ({
      movements: ix.phaseSets[g.set].map((m) => ix.movements[m].id),
      green: g.green,
    })),
  };
}

/** Converts a plan whose phases are candidate sets (e.g. Webster's) back into a genome. */
export function fromPlan(ix: CompiledIntersection, plan: SignalPlan): Genome {
  return plan.phases.flatMap((p) => {
    const set = ix.phaseSets.findIndex(
      (s) => s.length === p.movements.length && s.every((m) => p.movements.includes(ix.movements[m].id)),
    );
    return set >= 0 ? [{ set, green: p.green }] : [];
  });
}

export function genomeKey(genome: Genome): string {
  return genome.map((g) => `${g.set}:${g.green}`).join(',');
}

export function gaussian(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clampGreen = (g: number) => Math.min(MAX_GREEN, Math.max(MIN_GREEN, Math.round(g)));

export function randomGene(ix: CompiledIntersection, rng: Rng): Gene {
  return { set: rng.int(ix.phaseSets.length), green: clampGreen(MIN_GREEN + rng.next() * 35) };
}

export function randomGenome(ix: CompiledIntersection, rng: Rng): Genome {
  const n = MIN_PHASES + rng.int(3);
  return repair(ix, Array.from({ length: n }, () => randomGene(ix, rng)), rng);
}

/**
 * Makes a genome valid:
 * - greens are integers within [MIN_GREEN, MAX_GREEN];
 * - two consecutive identical phases are merged (also across the cycle wrap);
 * - every movement with demand is green in at least one phase;
 * - phase count stays within [MIN_PHASES, MAX_PHASES].
 */
export function repair(ix: CompiledIntersection, genome: Genome, rng: Rng): Genome {
  let g = genome.map((x) => ({ set: x.set, green: clampGreen(x.green) }));
  const needed = ix.movements.filter((m) => m.demand > 0).map((m) => m.index);

  for (let attempt = 0; attempt < 20; attempt++) {
    g = mergeDuplicates(g);
    if (g.length > MAX_PHASES) {
      g.splice(rng.int(g.length), 1);
      continue; // removal can make two identical phases adjacent: merge again
    }

    const covered = new Set(g.flatMap((x) => ix.phaseSets[x.set]));
    const missing = needed.filter((m) => !covered.has(m));
    if (missing.length === 0 && g.length >= MIN_PHASES) return g;

    if (missing.length > 0 && g.length >= MAX_PHASES) {
      // Replace the phase that serves the fewest movements exclusively.
      g.splice(leastUsefulPhase(ix, g), 1);
    }
    g.splice(rng.int(g.length + 1), 0, { set: coveringSet(ix, missing, rng), green: clampGreen(10 + rng.next() * 20) });
  }
  return g;
}

function mergeDuplicates(g: Genome): Genome {
  const out: Genome = [];
  for (const x of g) {
    const last = out[out.length - 1];
    if (last && last.set === x.set) last.green = clampGreen(last.green + x.green);
    else out.push({ ...x });
  }
  if (out.length > 1 && out[0].set === out[out.length - 1].set) {
    out[0].green = clampGreen(out[0].green + out[out.length - 1].green);
    out.pop();
  }
  return out;
}

/** A random candidate set, biased towards those covering more of the missing movements. */
function coveringSet(ix: CompiledIntersection, missing: number[], rng: Rng): number {
  if (missing.length === 0) return rng.int(ix.phaseSets.length);
  const weights = ix.phaseSets.map((s) => {
    const k = s.filter((m) => missing.includes(m)).length;
    return k * k;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.findIndex((w) => w > 0);
}

function leastUsefulPhase(ix: CompiledIntersection, g: Genome): number {
  let worst = 0;
  let worstCount = Infinity;
  g.forEach((x, i) => {
    const others = new Set(g.flatMap((y, j) => (j === i ? [] : ix.phaseSets[y.set])));
    const exclusive = ix.phaseSets[x.set].filter((m) => !others.has(m)).length;
    if (exclusive < worstCount) {
      worst = i;
      worstCount = exclusive;
    }
  });
  return worst;
}
