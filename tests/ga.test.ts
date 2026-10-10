import { describe, expect, it } from 'vitest';
import { evaluatePlan, type EvaluationSettings, DEFAULT_WEIGHTS } from '../src/ga/fitness';
import { DEFAULT_GA, GeneticAlgorithm } from '../src/ga/ga';
import { fromPlan, MAX_PHASES, MIN_PHASES, randomGenome, repair, toPlan, type Genome } from '../src/ga/genome';
import { crossover, mutate } from '../src/ga/operators';
import { websterPlan } from '../src/ga/webster';
import { compile } from '../src/model/intersection';
import { PRESETS } from '../src/model/presets';
import { Rng } from '../src/sim/rng';
import { MAX_GREEN, MIN_GREEN } from '../src/sim/signal';

const ix = compile(PRESETS[1]);

function expectValid(g: Genome): void {
  expect(g.length).toBeGreaterThanOrEqual(MIN_PHASES);
  expect(g.length).toBeLessThanOrEqual(MAX_PHASES);
  const covered = new Set(g.flatMap((x) => ix.phaseSets[x.set]));
  for (const m of ix.movements) if (m.demand > 0) expect(covered.has(m.index)).toBe(true);
  for (const x of g) {
    expect(Number.isInteger(x.green)).toBe(true);
    expect(x.green).toBeGreaterThanOrEqual(MIN_GREEN);
    expect(x.green).toBeLessThanOrEqual(MAX_GREEN);
  }
  for (let i = 0; i < g.length; i++) expect(g[i].set).not.toBe(g[(i + 1) % g.length].set);
}

describe('genome', () => {
  it('random genomes, crossover and mutation always produce valid genomes', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) {
      const a = randomGenome(ix, rng);
      const b = randomGenome(ix, rng);
      expectValid(a);
      expectValid(crossover(ix, a, b, rng));
      expectValid(mutate(ix, a, 0.9, rng));
    }
  });

  it('repairs an empty or oversized genome', () => {
    const rng = new Rng(2);
    expectValid(repair(ix, [], rng));
    expectValid(repair(ix, Array.from({ length: 12 }, (_, i) => ({ set: i % ix.phaseSets.length, green: 500 })), rng));
  });

  it('round-trips a Webster plan', () => {
    const plan = websterPlan(ix).plan;
    expect(toPlan(ix, fromPlan(ix, plan))).toEqual(plan);
  });
});

describe('genetic algorithm', () => {
  const settings: EvaluationSettings = { seeds: [1], warmup: 60, duration: 300, weights: DEFAULT_WEIGHTS };
  const evaluator = async (plans: ReturnType<typeof toPlan>[]) => plans.map((p) => evaluatePlan(ix, p, settings));

  it('never gets worse (elitism) and improves on a random start', async () => {
    const ga = new GeneticAlgorithm(ix, { ...DEFAULT_GA, populationSize: 16, seed: 3 }, evaluator);
    const first = await ga.initialize();
    let prev = first.bestFitness;
    for (let i = 0; i < 6; i++) {
      const s = await ga.step();
      expect(s.bestFitness).toBeLessThanOrEqual(prev);
      prev = s.bestFitness;
    }
    expect(prev).toBeLessThanOrEqual(first.bestFitness);
    expect(ga.population).toHaveLength(16);
  });

  it('is deterministic for a given seed', async () => {
    const run = async () => {
      const ga = new GeneticAlgorithm(ix, { ...DEFAULT_GA, populationSize: 8, seed: 5 }, evaluator);
      await ga.initialize();
      await ga.step();
      return ga.best!.genome;
    };
    expect(await run()).toEqual(await run());
  });
});
