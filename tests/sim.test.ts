import { describe, expect, it } from 'vitest';
import { compile } from '../src/model/intersection';
import { PRESETS } from '../src/model/presets';
import { Simulation, simulate } from '../src/sim/engine';
import { IDM } from '../src/sim/idm';
import { Rng } from '../src/sim/rng';
import { ALL_RED, SignalController, YELLOW, type SignalPlan } from '../src/sim/signal';
import { simplePlan } from '../src/sim/simplePlan';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(sa);
    expect(c.next()).not.toBe(sa[0]);
  });
});

describe('signal controller', () => {
  const plan: SignalPlan = {
    phases: [
      { movements: ['NS', 'NR'], green: 10 },
      { movements: ['NR', 'ES'], green: 20 },
    ],
  };
  const ctl = new SignalController(plan, ['NS', 'NR', 'ES']);

  it('cycles through green, yellow and all-red', () => {
    expect(ctl.cycle).toBe(30 + 2 * (YELLOW + ALL_RED));
    expect(ctl.lights(0)).toEqual(['G', 'G', 'R']);
    expect(ctl.lights(10.5)).toEqual(['Y', 'G', 'R']); // NR stays green into next phase
    expect(ctl.lights(10 + YELLOW + 0.5)).toEqual(['R', 'G', 'R']);
    expect(ctl.lights(10 + YELLOW + ALL_RED + 0.5)).toEqual(['R', 'G', 'G']);
    expect(ctl.lights(ctl.cycle + 1)).toEqual(['G', 'G', 'R']);
  });

  it('reports phase status', () => {
    const s = ctl.status(12);
    expect(s.phase).toBe(0);
    expect(s.stage).toBe('yellow');
    expect(s.remaining).toBeCloseTo(1);
  });
});

describe('simple plan', () => {
  for (const preset of PRESETS) {
    it(`serves every movement: ${preset.name}`, () => {
      const ix = compile(preset);
      const plan = simplePlan(ix);
      const served = new Set(plan.phases.flatMap((p) => p.movements));
      for (const m of ix.movements) expect(served.has(m.id)).toBe(true);
    });
  }
});

describe('simulation', () => {
  const ix = compile(PRESETS[0]);
  const plan = simplePlan(ix);

  it('is deterministic for a given seed', () => {
    const a = simulate(ix, plan, { seed: 7, duration: 300 });
    const b = simulate(ix, plan, { seed: 7, duration: 300 });
    const c = simulate(ix, plan, { seed: 8, duration: 300 });
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('conserves vehicles and never overlaps them', () => {
    const sim = new Simulation(ix, plan, { seed: 1 });
    for (let i = 0; i < 1200; i++) {
      sim.step();
      for (const c of [...sim.inbound, ...sim.box]) {
        for (let k = 1; k < c.vehicles.length; k++) {
          const gap = c.vehicles[k - 1].d - IDM.length - c.vehicles[k].d;
          expect(gap).toBeGreaterThan(-0.01);
        }
      }
    }
    const m = sim.metrics();
    expect(m.completed + m.unserved).toBe(m.measured);
    expect(m.completed).toBeGreaterThan(0);
  });

  it('only lets movements with green light through', () => {
    const only: SignalPlan = { phases: [{ movements: ['NS', 'SS'], green: 30 }] };
    const sim = new Simulation(ix, only, { seed: 3 });
    sim.run(600);
    for (const c of [...sim.box, ...sim.exit])
      for (const v of c.vehicles) expect(['NS', 'SS']).toContain(ix.movements[v.route.movement].id);
    // Other approaches keep queuing.
    expect(sim.backlogSize()).toBeGreaterThan(0);
  });

  it('serves light traffic with small delay', () => {
    const light = structuredClone(PRESETS[0]);
    for (const arm of Object.values(light.arms)) arm.demand = { L: 30, S: 100, R: 30 };
    const m = simulate(compile(light), simplePlan(compile(light)), { seed: 5 });
    expect(m.unserved).toBeLessThan(15);
    expect(m.avgDelay).toBeGreaterThan(0);
    expect(m.avgDelay).toBeLessThan(60);
  });

  it('a starving plan is much worse than a sensible one', () => {
    const good = simulate(ix, plan, { seed: 9 });
    const starving: SignalPlan = {
      phases: plan.phases.map((p, i) => ({ ...p, green: i === 0 ? 60 : 5 })),
    };
    const bad = simulate(ix, starving, { seed: 9 });
    expect(bad.avgDelay).toBeGreaterThan(good.avgDelay);
  });

  it('runs a 17-minute evaluation quickly', () => {
    const t0 = performance.now();
    simulate(compile(PRESETS[1]), simplePlan(compile(PRESETS[1])), { seed: 1 });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
