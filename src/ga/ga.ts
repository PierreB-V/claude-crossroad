import type { CompiledIntersection } from '../model/intersection';
import { Rng } from '../sim/rng';
import type { SignalPlan } from '../sim/signal';
import type { Evaluation } from './fitness';
import { genomeKey, randomGenome, toPlan, type Genome } from './genome';
import { crossover, mutate, tournament } from './operators';

export interface GaSettings {
  populationSize: number;
  eliteCount: number;
  tournamentSize: number;
  crossoverRate: number;
  mutationRate: number;
  seed: number;
}

export const DEFAULT_GA: GaSettings = {
  populationSize: 40,
  eliteCount: 2,
  tournamentSize: 3,
  crossoverRate: 0.8,
  mutationRate: 0.25,
  seed: 1,
};

export interface Individual {
  genome: Genome;
  evaluation: Evaluation;
}

export interface GenerationStats {
  generation: number;
  best: Individual;
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
  /** Distinct genomes in the population (diversity indicator). */
  distinct: number;
  /** Fresh simulations run for this generation (cached genomes are free). */
  evaluated: number;
}

/** Evaluates a batch of plans (in workers in the app, synchronously in tests). */
export type BatchEvaluator = (plans: SignalPlan[]) => Promise<Evaluation[]>;

/** Generational GA with elitism and tournament selection. Minimizes fitness. */
export class GeneticAlgorithm {
  generation = 0;
  population: Individual[] = [];
  private readonly rng: Rng;
  private readonly cache = new Map<string, Evaluation>();

  constructor(
    readonly ix: CompiledIntersection,
    readonly settings: GaSettings,
    private readonly evaluate: BatchEvaluator,
  ) {
    this.rng = new Rng(settings.seed);
  }

  get best(): Individual | undefined {
    return this.population[0];
  }

  /** Creates and evaluates the initial population; `seeds` (e.g. Webster) are included as-is. */
  async initialize(seeds: Genome[] = []): Promise<GenerationStats> {
    const genomes = seeds.slice(0, this.settings.populationSize);
    while (genomes.length < this.settings.populationSize) genomes.push(randomGenome(this.ix, this.rng));
    const evaluated = await this.assess(genomes);
    return this.stats(evaluated);
  }

  /** Breeds and evaluates one generation. */
  async step(): Promise<GenerationStats> {
    const s = this.settings;
    const fitness = this.population.map((i) => i.evaluation.fitness);
    const next: Genome[] = this.population.slice(0, s.eliteCount).map((i) => i.genome);
    while (next.length < s.populationSize) {
      const a = this.population[tournament(fitness, s.tournamentSize, this.rng)].genome;
      let child: Genome;
      if (this.rng.next() < s.crossoverRate) {
        const b = this.population[tournament(fitness, s.tournamentSize, this.rng)].genome;
        child = crossover(this.ix, a, b, this.rng);
      } else {
        child = a;
      }
      next.push(mutate(this.ix, child, s.mutationRate, this.rng));
    }
    this.generation++;
    const evaluated = await this.assess(next);
    return this.stats(evaluated);
  }

  private async assess(genomes: Genome[]): Promise<number> {
    const keys = genomes.map(genomeKey);
    const todo = [...new Set(keys.filter((k) => !this.cache.has(k)))];
    if (todo.length > 0) {
      const byKey = new Map(genomes.map((g, i) => [keys[i], g]));
      const results = await this.evaluate(todo.map((k) => toPlan(this.ix, byKey.get(k)!)));
      todo.forEach((k, i) => this.cache.set(k, results[i]));
    }
    this.population = genomes
      .map((genome, i) => ({ genome, evaluation: this.cache.get(keys[i])! }))
      .sort((a, b) => a.evaluation.fitness - b.evaluation.fitness);
    return todo.length;
  }

  private stats(evaluated: number): GenerationStats {
    const f = this.population.map((i) => i.evaluation.fitness);
    return {
      generation: this.generation,
      best: this.population[0],
      bestFitness: f[0],
      avgFitness: f.reduce((a, b) => a + b, 0) / f.length,
      worstFitness: f[f.length - 1],
      distinct: new Set(this.population.map((i) => genomeKey(i.genome))).size,
      evaluated,
    };
  }
}
