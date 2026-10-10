import type { MovementId } from '../model/types';

export const YELLOW = 3;
export const ALL_RED = 2;
export const MIN_GREEN = 5;
export const MAX_GREEN = 60;

export interface Phase {
  movements: MovementId[];
  /** Green time in seconds. */
  green: number;
}

export interface SignalPlan {
  phases: Phase[];
}

export type Light = 'G' | 'Y' | 'R';
export type Stage = 'green' | 'yellow' | 'allred';

export interface PhaseStatus {
  phase: number;
  stage: Stage;
  /** Seconds left in the current stage. */
  remaining: number;
  /** Seconds since the start of the cycle. */
  cycleTime: number;
}

export function cycleLength(plan: SignalPlan): number {
  return plan.phases.reduce((sum, p) => sum + p.green + YELLOW + ALL_RED, 0);
}

/**
 * Fixed-time controller. A movement that is green in two consecutive phases stays green
 * through the inter-green instead of flashing yellow/red.
 */
export class SignalController {
  readonly cycle: number;
  private readonly green: boolean[][]; // [phase][movement]

  constructor(
    readonly plan: SignalPlan,
    readonly movementIds: readonly MovementId[],
  ) {
    this.cycle = cycleLength(plan);
    this.green = plan.phases.map((p) => movementIds.map((id) => p.movements.includes(id)));
  }

  status(t: number): PhaseStatus {
    const n = this.plan.phases.length;
    if (n === 0 || this.cycle <= 0) return { phase: 0, stage: 'allred', remaining: Infinity, cycleTime: 0 };
    const cycleTime = ((t % this.cycle) + this.cycle) % this.cycle;
    let start = 0;
    for (let k = 0; k < n; k++) {
      const g = this.plan.phases[k].green;
      if (cycleTime < start + g) return { phase: k, stage: 'green', remaining: start + g - cycleTime, cycleTime };
      if (cycleTime < start + g + YELLOW)
        return { phase: k, stage: 'yellow', remaining: start + g + YELLOW - cycleTime, cycleTime };
      if (cycleTime < start + g + YELLOW + ALL_RED)
        return { phase: k, stage: 'allred', remaining: start + g + YELLOW + ALL_RED - cycleTime, cycleTime };
      start += g + YELLOW + ALL_RED;
    }
    return { phase: n - 1, stage: 'allred', remaining: 0, cycleTime };
  }

  /** Light shown to each movement (same order as `movementIds`). */
  lights(t: number, out: Light[] = []): Light[] {
    const n = this.plan.phases.length;
    out.length = this.movementIds.length;
    if (n === 0) return out.fill('R');
    const s = this.status(t);
    const now = this.green[s.phase];
    const next = this.green[(s.phase + 1) % n];
    for (let m = 0; m < out.length; m++) {
      if (s.stage === 'green') out[m] = now[m] ? 'G' : 'R';
      else if (now[m] && next[m]) out[m] = 'G';
      else out[m] = s.stage === 'yellow' && now[m] ? 'Y' : 'R';
    }
    return out;
  }
}
