import type { Evaluation, EvaluationSettings } from '../ga/fitness';
import type { IntersectionConfig } from '../model/types';
import type { SignalPlan } from '../sim/signal';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Spreads plan evaluations over several Web Workers. */
export class EvaluatorPool {
  readonly size: number;
  private readonly workers: Worker[];
  private readonly pending = new Map<number, (r: Evaluation[]) => void>();
  private nextId = 1;

  constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
    this.size = size;
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(new URL('./evalWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.pending.get(e.data.id)?.(e.data.results);
        this.pending.delete(e.data.id);
      };
      return w;
    });
  }

  setContext(config: IntersectionConfig, settings: EvaluationSettings): void {
    const msg: WorkerRequest = { type: 'context', config, settings };
    for (const w of this.workers) w.postMessage(msg);
  }

  /** Evaluates plans in parallel; results are in the same order as `plans`. */
  async evaluate(plans: SignalPlan[]): Promise<Evaluation[]> {
    // Small chunks balance the load when some plans simulate slower than others.
    const chunk = Math.max(1, Math.ceil(plans.length / (this.size * 3)));
    const jobs: Promise<Evaluation[]>[] = [];
    for (let i = 0, k = 0; i < plans.length; i += chunk, k++) {
      const id = this.nextId++;
      const msg: WorkerRequest = { type: 'evaluate', id, plans: plans.slice(i, i + chunk) };
      jobs.push(new Promise((resolve) => this.pending.set(id, resolve)));
      this.workers[k % this.size].postMessage(msg);
    }
    return (await Promise.all(jobs)).flat();
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.pending.clear();
  }
}
