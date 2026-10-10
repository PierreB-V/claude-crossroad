import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { EvaluationSettings, FitnessWeights } from '../ga/fitness';
import { DEFAULT_GA, GeneticAlgorithm, type GaSettings, type GenerationStats } from '../ga/ga';
import { fromPlan, toPlan } from '../ga/genome';
import { websterPlan } from '../ga/webster';
import type { CompiledIntersection } from '../model/intersection';
import type { SignalPlan } from '../sim/signal';
import { EvaluatorPool } from '../worker/pool';
import { definitionList, renderPlanList } from './chips';

export interface OptimizerHost {
  intersection(): CompiledIntersection;
  usePlan(plan: SignalPlan, label: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);

const SETTING_INPUTS = ['ga-pop', 'ga-gens', 'ga-mut', 'ga-seeds', 'ga-webster', 'w-delay', 'w-stops', 'w-queue', 'w-unserved'];

export class OptimizerPanel {
  private pool: EvaluatorPool | null = null;
  private ga: GeneticAlgorithm | null = null;
  private generations = 0;
  private running = false;
  /** Incremented on reset so a run in flight knows it was cancelled. */
  private token = 0;
  private websterFitness = NaN;
  private history: [number[], number[], number[], number[]] = [[], [], [], []];
  private chart: uPlot | null = null;
  private last: GenerationStats | null = null;

  private readonly runButton = $<HTMLButtonElement>('ga-run');
  private readonly useButton = $<HTMLButtonElement>('ga-use');
  private readonly status = $<HTMLParagraphElement>('ga-status');
  private readonly chartDiv = $<HTMLDivElement>('ga-chart');
  private readonly bestList = $<HTMLOListElement>('ga-best');
  private readonly bestStats = $<HTMLDListElement>('ga-best-stats');

  constructor(private readonly host: OptimizerHost) {
    this.runButton.onclick = () => (this.running ? this.pause() : void this.run());
    $<HTMLButtonElement>('ga-reset').onclick = () => this.reset();
    this.useButton.onclick = () => this.useBest();
    this.reset();
  }

  reset(): void {
    this.token++;
    this.running = false;
    this.ga = null;
    this.last = null;
    this.websterFitness = NaN;
    this.history = [[], [], [], []];
    this.runButton.textContent = 'Start';
    this.useButton.disabled = true;
    this.bestList.replaceChildren();
    this.bestStats.replaceChildren();
    this.status.textContent = 'Press Start to evolve a signal plan for this intersection.';
    this.setInputsLocked(false);
    this.drawChart();
  }

  /** Redraws the chart (its width is only known once the tab is visible). */
  refresh(): void {
    this.drawChart();
  }

  private pause(): void {
    this.running = false;
    this.runButton.textContent = 'Resume';
  }

  private readSettings(): { ga: GaSettings; evaluation: EvaluationSettings } {
    const weights: FitnessWeights = {
      delay: num('w-delay'),
      stops: num('w-stops'),
      queue: num('w-queue'),
      unserved: num('w-unserved'),
    };
    const seedCount = Math.max(1, Math.min(5, Math.round(num('ga-seeds'))));
    return {
      ga: {
        ...DEFAULT_GA,
        populationSize: Math.max(6, Math.round(num('ga-pop'))),
        mutationRate: Math.max(0, Math.min(1, num('ga-mut'))),
      },
      evaluation: {
        seeds: Array.from({ length: seedCount }, (_, i) => i + 1),
        warmup: 120,
        duration: 900,
        weights,
      },
    };
  }

  private setInputsLocked(locked: boolean): void {
    for (const id of SETTING_INPUTS) $<HTMLInputElement>(id).disabled = locked;
  }

  private async run(): Promise<void> {
    const token = this.token;
    this.running = true;
    this.runButton.textContent = 'Pause';
    const batch = Math.max(1, Math.round(num('ga-gens')));
    if (!this.ga) this.generations = batch;
    else if (this.ga.generation >= this.generations) this.generations += batch;

    if (!this.ga) {
      const ix = this.host.intersection();
      if (ix.errors.length > 0 || ix.phaseSets.length === 0) {
        this.status.textContent = 'Fix the intersection errors first.';
        this.reset();
        return;
      }
      this.setInputsLocked(true);
      const { ga, evaluation } = this.readSettings();
      this.pool ??= new EvaluatorPool();
      this.pool.setContext(ix.config, evaluation);
      const pool = this.pool;
      this.status.textContent = `Evaluating initial population on ${pool.size} workers…`;

      const webster = websterPlan(ix).plan;
      const [websterEval] = await pool.evaluate([webster]);
      if (token !== this.token) return;
      this.websterFitness = websterEval.fitness;

      this.ga = new GeneticAlgorithm(ix, ga, (plans) => pool.evaluate(plans));
      const seeds = $<HTMLInputElement>('ga-webster').checked ? [fromPlan(ix, webster)] : [];
      const stats = await this.ga.initialize(seeds);
      if (token !== this.token) return;
      this.record(stats, 0);
    }

    while (this.running && token === this.token && this.ga.generation < this.generations) {
      const t0 = performance.now();
      const stats = await this.ga.step();
      if (token !== this.token) return;
      this.record(stats, performance.now() - t0);
    }
    if (token === this.token && this.ga && this.ga.generation >= this.generations) {
      this.running = false;
      this.runButton.textContent = 'Continue';
      this.status.textContent += ' · done';
    }
  }

  private record(stats: GenerationStats, ms: number): void {
    this.last = stats;
    this.history[0].push(stats.generation);
    this.history[1].push(stats.bestFitness);
    this.history[2].push(stats.avgFitness);
    this.history[3].push(this.websterFitness);
    this.drawChart();

    const timing = ms > 0 ? ` · ${(ms / 1000).toFixed(2)} s/gen` : '';
    this.status.textContent =
      `Generation ${stats.generation} / ${this.generations} · ${this.pool?.size ?? 0} workers${timing}` +
      ` · ${stats.distinct} distinct plans`;

    const ix = this.host.intersection();
    renderPlanList(this.bestList, toPlan(ix, stats.best.genome));
    const m = stats.best.evaluation.metrics;
    const gain = (1 - stats.bestFitness / this.websterFitness) * 100;
    definitionList(this.bestStats, [
      ['Fitness', stats.bestFitness.toFixed(1)],
      ['vs Webster', `${this.websterFitness.toFixed(1)} (${gain >= 0 ? '−' : '+'}${Math.abs(gain).toFixed(0)}%)`],
      ['Avg delay', `${m.avgDelay.toFixed(1)} s`],
      ['Avg stops', m.avgStops.toFixed(2)],
      ['Max queue', `${m.maxQueue.toFixed(1)} veh`],
      ['Unserved at end', m.unserved.toFixed(1)],
    ]);
    this.useButton.disabled = false;
  }

  private useBest(): void {
    if (!this.last) return;
    const ix = this.host.intersection();
    this.host.usePlan(
      toPlan(ix, this.last.best.genome),
      `GA best · generation ${this.last.generation} · fitness ${this.last.bestFitness.toFixed(1)}`,
    );
  }

  private drawChart(): void {
    const width = this.chartDiv.clientWidth || 300;
    if (!this.chart || this.chart.width !== width) {
      this.chart?.destroy();
      const axis = { stroke: '#8b919c', grid: { stroke: '#2e323a', width: 1 }, ticks: { stroke: '#2e323a' } };
      this.chart = new uPlot(
        {
          width,
          height: 190,
          scales: { x: { time: false } },
          axes: [{ ...axis, label: 'generation' }, { ...axis, size: 44 }],
          series: [
            { label: 'gen' },
            { label: 'Best', stroke: '#4cc9a6', width: 2 },
            { label: 'Average', stroke: '#7aa7ff', width: 1 },
            { label: 'Webster', stroke: '#ffc23d', width: 1.5, dash: [5, 4] },
          ],
          legend: { live: false },
          cursor: { show: false },
        },
        this.history,
        this.chartDiv,
      );
    } else {
      this.chart.setData(this.history);
    }
  }
}
