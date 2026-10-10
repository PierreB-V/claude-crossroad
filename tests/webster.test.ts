import { describe, expect, it } from 'vitest';
import { DEFAULT_EVALUATION, evaluatePlan, fitnessOf, DEFAULT_WEIGHTS } from '../src/ga/fitness';
import { websterPlan } from '../src/ga/webster';
import { compile } from '../src/model/intersection';
import { PRESETS } from '../src/model/presets';
import { MAX_GREEN, MIN_GREEN } from '../src/sim/signal';
import { simplePlan } from '../src/sim/simplePlan';

describe('webster', () => {
  for (const preset of PRESETS) {
    it(`produces a valid plan that serves every movement: ${preset.name}`, () => {
      const ix = compile(preset);
      const w = websterPlan(ix);
      expect(w.Y).toBeGreaterThan(0);
      expect(w.plan.phases.length).toBeGreaterThanOrEqual(2);
      const served = new Set(w.plan.phases.flatMap((p) => p.movements));
      for (const m of ix.movements) if (m.demand > 0) expect(served.has(m.id)).toBe(true);
      for (const p of w.plan.phases) {
        expect(p.green).toBeGreaterThanOrEqual(MIN_GREEN);
        expect(p.green).toBeLessThanOrEqual(MAX_GREEN);
      }
    });
  }

  it('gives more green to the busier phase', () => {
    const w = websterPlan(compile(PRESETS[1]));
    const main = w.plan.phases.find((p) => p.movements.includes('NS'))!;
    const side = w.plan.phases.find((p) => p.movements.includes('ES'))!;
    expect(main.green).toBeGreaterThan(side.green);
  });

  it('flags oversaturated demand', () => {
    const cfg = structuredClone(PRESETS[0]);
    for (const a of Object.values(cfg.arms)) a.demand = { L: 400, S: 1500, R: 300 };
    expect(websterPlan(compile(cfg)).oversaturated).toBe(true);
  });

  it('beats the naive equal-split plan', () => {
    const ix = compile(PRESETS[1]);
    const naive = evaluatePlan(ix, simplePlan(ix), DEFAULT_EVALUATION);
    const webster = evaluatePlan(ix, websterPlan(ix).plan, DEFAULT_EVALUATION);
    expect(webster.fitness).toBeLessThan(naive.fitness);
  });
});

describe('fitness', () => {
  it('is a weighted sum of metrics', () => {
    const m = {
      time: 0,
      measured: 0,
      completed: 0,
      unserved: 10,
      avgDelay: 30,
      avgStops: 1,
      throughput: 0,
      maxQueue: 8,
    };
    expect(fitnessOf(m, DEFAULT_WEIGHTS)).toBeCloseTo(30 * 1 + 1 * 5 + 8 * 0.5 + 10 * 0.5);
  });
});
