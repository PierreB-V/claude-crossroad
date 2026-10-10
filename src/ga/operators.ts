import type { CompiledIntersection } from '../model/intersection';
import type { Rng } from '../sim/rng';
import { gaussian, randomGene, repair, type Genome } from './genome';

/** Standard deviation of the green-time mutation, s. */
const GREEN_SIGMA = 5;

/**
 * Cut-and-splice crossover: head of one parent + tail of the other, cut points chosen
 * independently so children can have a different number of phases than their parents.
 */
export function crossover(ix: CompiledIntersection, a: Genome, b: Genome, rng: Rng): Genome {
  const cutA = 1 + rng.int(a.length);
  const cutB = rng.int(b.length);
  const child = [...a.slice(0, cutA), ...b.slice(cutB)].map((g) => ({ ...g }));
  return repair(ix, child, rng);
}

/**
 * Per gene, with probability `rate`: nudge the green time; with probability `rate / 3`:
 * switch to another candidate phase. Per genome, structural moves with probability `rate / 2`:
 * swap two phases, insert a phase, or delete one.
 */
export function mutate(ix: CompiledIntersection, genome: Genome, rate: number, rng: Rng): Genome {
  const g = genome.map((x) => ({ ...x }));
  for (const gene of g) {
    if (rng.next() < rate) gene.green += gaussian(rng) * GREEN_SIGMA;
    if (rng.next() < rate / 3) gene.set = rng.int(ix.phaseSets.length);
  }
  if (rng.next() < rate / 2) {
    const kind = rng.int(3);
    if (kind === 0 && g.length >= 2) {
      const i = rng.int(g.length);
      const j = rng.int(g.length);
      [g[i], g[j]] = [g[j], g[i]];
    } else if (kind === 1) {
      g.splice(rng.int(g.length + 1), 0, randomGene(ix, rng));
    } else if (g.length > 2) {
      g.splice(rng.int(g.length), 1);
    }
  }
  return repair(ix, g, rng);
}

/** Index of the fittest (lowest fitness) of `k` random individuals. */
export function tournament(fitness: readonly number[], k: number, rng: Rng): number {
  let best = rng.int(fitness.length);
  for (let i = 1; i < k; i++) {
    const c = rng.int(fitness.length);
    if (fitness[c] < fitness[best]) best = c;
  }
  return best;
}
