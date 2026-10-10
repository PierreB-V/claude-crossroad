import { describe, expect, it } from 'vitest';
import { bezierPoint, targetArm } from '../src/model/geometry';
import { compile, withDefaultLaneTurns, type CompiledIntersection } from '../src/model/intersection';
import { defaultLaneTurns, exitLaneFor, lanesAreOrdered } from '../src/model/lanes';
import { PRESETS } from '../src/model/presets';
import type { ArmConfig, IntersectionConfig, MovementId } from '../src/model/types';

const arm = (inLanes: number, outLanes = inLanes): ArmConfig => ({
  enabled: true,
  inLanes,
  outLanes,
  laneTurns: [],
  demand: { L: 100, S: 100, R: 100 },
});

const fourWay = (lanes = 1, outLanes = lanes): IntersectionConfig =>
  withDefaultLaneTurns({
    name: 'test',
    arms: { N: arm(lanes, outLanes), E: arm(lanes, outLanes), S: arm(lanes, outLanes), W: arm(lanes, outLanes) },
  });

function conflict(ix: CompiledIntersection, a: MovementId, b: MovementId): boolean {
  const i = ix.movements.findIndex((m) => m.id === a);
  const j = ix.movements.findIndex((m) => m.id === b);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThanOrEqual(0);
  expect(ix.conflicts[i][j]).toBe(ix.conflicts[j][i]);
  return ix.conflicts[i][j];
}

describe('geometry', () => {
  it('maps turns to target arms for right-hand traffic', () => {
    expect(targetArm('N', 'L')).toBe('E');
    expect(targetArm('N', 'S')).toBe('S');
    expect(targetArm('N', 'R')).toBe('W');
    expect(targetArm('W', 'L')).toBe('N');
    expect(targetArm('S', 'R')).toBe('E');
  });
});

describe('lanes', () => {
  it('generates sensible defaults', () => {
    expect(defaultLaneTurns(['L', 'S', 'R'], 1)).toEqual([['L', 'S', 'R']]);
    expect(defaultLaneTurns(['L', 'S', 'R'], 3)).toEqual([['L', 'S'], ['S'], ['S', 'R']]);
    expect(defaultLaneTurns(['L', 'R'], 2)).toEqual([['L'], ['R']]);
    expect(defaultLaneTurns(['L', 'R'], 3)).toEqual([['L'], ['L'], ['R']]);
  });

  it('detects crossing lane assignments', () => {
    expect(lanesAreOrdered([['L', 'S'], ['S', 'R']])).toBe(true);
    expect(lanesAreOrdered([['S'], ['L']])).toBe(false);
    expect(lanesAreOrdered([['R'], ['S']])).toBe(false);
  });

  it('assigns exit lanes from the inside for L/S and from the outside for R', () => {
    expect(exitLaneFor('L', 0, 1, 3)).toBe(0);
    expect(exitLaneFor('S', 2, 3, 2)).toBe(1);
    expect(exitLaneFor('R', 0, 1, 3)).toBe(2);
    expect(exitLaneFor('R', 0, 2, 3)).toBe(1);
  });
});

describe('conflicts', () => {
  const ix = compile(fourWay(1));

  it('compiles a 1-lane 4-way without errors', () => {
    expect(ix.errors).toEqual([]);
    expect(ix.movements).toHaveLength(12);
  });

  it('applies the textbook rules', () => {
    expect(conflict(ix, 'NS', 'SS')).toBe(false); // opposing throughs
    expect(conflict(ix, 'NL', 'SL')).toBe(false); // opposing lefts
    expect(conflict(ix, 'NL', 'SS')).toBe(true); // left vs opposing through
    expect(conflict(ix, 'NS', 'ES')).toBe(true); // crossing throughs
    expect(conflict(ix, 'NL', 'EL')).toBe(true); // crossing lefts
    expect(conflict(ix, 'NS', 'NL')).toBe(false); // same approach
    expect(conflict(ix, 'NR', 'ES')).toBe(true); // merge into W, single lane
    expect(conflict(ix, 'NR', 'EL')).toBe(false);
    expect(conflict(ix, 'NR', 'SR')).toBe(false);
  });

  it('allows merges into different exit lanes', () => {
    const cfg = fourWay(1);
    cfg.arms.W.outLanes = 2;
    const wide = compile(cfg);
    expect(conflict(wide, 'NR', 'ES')).toBe(false); // ES → W lane 0, NR → W lane 1
    expect(conflict(wide, 'NR', 'SL')).toBe(false);
    expect(conflict(wide, 'ES', 'SL')).toBe(true); // both use W lane 0 and they cross
  });
});

describe('phase sets', () => {
  for (const preset of PRESETS) {
    it(`are maximal, conflict-free and cover every movement: ${preset.name}`, () => {
      const ix = compile(preset);
      expect(ix.errors).toEqual([]);
      const n = ix.movements.length;
      expect(ix.phaseSets.length).toBeGreaterThan(1);
      const covered = new Set<number>();
      for (const set of ix.phaseSets) {
        for (const a of set) {
          covered.add(a);
          for (const b of set) expect(ix.conflicts[a][b]).toBe(false);
        }
        for (let v = 0; v < n; v++) {
          if (set.includes(v)) continue;
          expect(set.some((u) => ix.conflicts[u][v])).toBe(true); // maximality
        }
      }
      expect(covered.size).toBe(n);
    });
  }
});

describe('paths', () => {
  it('start at the stop line and end on the exit arm', () => {
    const ix = compile(PRESETS[0]);
    const h = ix.halfSize;
    for (const p of ix.paths) {
      const start = bezierPoint(p.curve, 0);
      const end = bezierPoint(p.curve, 1);
      expect(Math.max(Math.abs(start.x), Math.abs(start.y))).toBeCloseTo(h);
      expect(Math.max(Math.abs(end.x), Math.abs(end.y))).toBeCloseTo(h);
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('T-junction has 6 movements and no movement towards the missing arm', () => {
    const ix = compile(PRESETS[2]);
    expect(ix.movements.map((m) => m.id).sort()).toEqual(['EL', 'ES', 'SL', 'SR', 'WR', 'WS']);
  });
});

describe('validation', () => {
  it('rejects fewer than 3 arms and crossing lanes', () => {
    const cfg = fourWay(2);
    cfg.arms.N.enabled = false;
    cfg.arms.E.enabled = false;
    expect(compile(cfg).errors.some((e) => e.includes('3 arms'))).toBe(true);

    const crossing = fourWay(2);
    crossing.arms.S.laneTurns = [['S', 'R'], ['L']];
    expect(compile(crossing).errors.some((e) => e.includes('cross'))).toBe(true);
  });
});
