import type { CompiledIntersection } from '../model/intersection';
import { simulate, type Metrics } from '../sim/engine';
import type { SignalPlan } from '../sim/signal';

/** Weights of the (minimized) fitness. Units: per second of delay, per vehicle, per stop. */
export interface FitnessWeights {
  delay: number;
  stops: number;
  queue: number;
  unserved: number;
}

export const DEFAULT_WEIGHTS: FitnessWeights = { delay: 1, stops: 5, queue: 0.5, unserved: 0.5 };

export interface EvaluationSettings {
  seeds: number[];
  warmup: number;
  duration: number;
  weights: FitnessWeights;
}

export const DEFAULT_EVALUATION: EvaluationSettings = {
  seeds: [1, 2],
  warmup: 120,
  duration: 900,
  weights: DEFAULT_WEIGHTS,
};

export interface Evaluation {
  fitness: number;
  /** Metrics averaged over seeds. */
  metrics: Metrics;
}

export function fitnessOf(m: Metrics, w: FitnessWeights): number {
  return w.delay * m.avgDelay + w.stops * m.avgStops + w.queue * m.maxQueue + w.unserved * m.unserved;
}

/** Simulates the plan once per seed (same seeds for every plan: common random numbers). */
export function evaluatePlan(ix: CompiledIntersection, plan: SignalPlan, s: EvaluationSettings): Evaluation {
  const runs = s.seeds.map((seed) => simulate(ix, plan, { seed, warmup: s.warmup, duration: s.duration }));
  const metrics = averageMetrics(runs);
  return { fitness: fitnessOf(metrics, s.weights), metrics };
}

export function averageMetrics(runs: Metrics[]): Metrics {
  const avg = (f: (m: Metrics) => number) => runs.reduce((sum, m) => sum + f(m), 0) / runs.length;
  return {
    time: avg((m) => m.time),
    measured: avg((m) => m.measured),
    completed: avg((m) => m.completed),
    unserved: avg((m) => m.unserved),
    avgDelay: avg((m) => m.avgDelay),
    avgStops: avg((m) => m.avgStops),
    throughput: avg((m) => m.throughput),
    maxQueue: avg((m) => m.maxQueue),
  };
}
