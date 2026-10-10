import { compile, type CompiledIntersection } from './model/intersection';
import { PRESETS } from './model/presets';
import type { IntersectionConfig, MovementId } from './model/types';
import { EXIT_LENGTH, Simulation } from './sim/engine';
import { cycleLength, MAX_GREEN, MIN_GREEN, type SignalPlan } from './sim/signal';
import { simplePlan } from './sim/simplePlan';
import { ARM_COLORS, defaultExtent, drawIntersection, type PathStyle } from './ui/render';
import { drawBacklog, drawSignals, drawVehicles } from './ui/simRender';
import './style.css';

type Selection = { kind: 'none' } | { kind: 'phase'; index: number } | { kind: 'movement'; id: MovementId };

/** Simulated seconds per animation frame are capped to keep the UI responsive. */
const MAX_STEPS_PER_FRAME = 400;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const presetSelect = $<HTMLSelectElement>('preset');
const errorsList = $<HTMLUListElement>('errors');
const planList = $<HTMLOListElement>('plan');
const cycleLabel = $<HTMLSpanElement>('cycle');
const playButton = $<HTMLButtonElement>('play');
const speedSelect = $<HTMLSelectElement>('speed');
const seedInput = $<HTMLInputElement>('seed');
const statsList = $<HTMLDListElement>('stats');
const phasesList = $<HTMLOListElement>('phases');
const matrixDiv = $<HTMLDivElement>('matrix');
const stage = $<HTMLDivElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

let ix: CompiledIntersection;
let plan: SignalPlan;
let sim: Simulation;
let selection: Selection = { kind: 'none' };
let playing = false;
let extent = 0;
let accumulator = 0;
let lastFrame = 0;
let lastStats = 0;
let activePhaseKey = '';

// --- state changes ---------------------------------------------------------

function loadConfig(config: IntersectionConfig): void {
  ix = compile(structuredClone(config));
  plan = simplePlan(ix);
  selection = { kind: 'none' };
  extent = defaultExtent(ix);
  restart();
  renderStaticSidebar();
}

function restart(): void {
  sim = new Simulation(ix, plan, { seed: Number(seedInput.value) || 0 });
  accumulator = 0;
  activePhaseKey = '';
  renderPlan();
  renderStats();
}

function setPlaying(on: boolean): void {
  playing = on;
  playButton.textContent = on ? 'Pause' : 'Play';
  lastFrame = performance.now();
}

function select(next: Selection): void {
  const same =
    (next.kind === 'phase' && selection.kind === 'phase' && next.index === selection.index) ||
    (next.kind === 'movement' && selection.kind === 'movement' && next.id === selection.id);
  selection = same ? { kind: 'none' } : next;
  renderStaticSidebar();
}

// --- sidebar ---------------------------------------------------------------

function chip(id: MovementId): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = id;
  span.style.background = ARM_COLORS[id[0] as keyof typeof ARM_COLORS];
  return span;
}

function renderPlan(): void {
  planList.replaceChildren(
    ...plan.phases.map((phase) => {
      const li = document.createElement('li');
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...phase.movements.map(chip));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(MIN_GREEN);
      input.max = String(MAX_GREEN);
      input.value = String(phase.green);
      input.title = 'Green time (s)';
      input.onchange = () => {
        const g = Math.round(Number(input.value));
        phase.green = Math.min(MAX_GREEN, Math.max(MIN_GREEN, Number.isFinite(g) ? g : MIN_GREEN));
        restart();
      };
      li.append(chips, input, document.createTextNode('s'));
      return li;
    }),
  );
  cycleLabel.textContent = `Cycle: ${cycleLength(plan)} s`;
}

function highlightActivePhase(): void {
  const s = sim.signals.status(sim.time);
  const key = `${s.phase}:${s.stage}`;
  if (key === activePhaseKey) return;
  activePhaseKey = key;
  [...planList.children].forEach((li, i) => {
    li.className = i === s.phase ? `active-${s.stage}` : '';
  });
}

function renderStats(): void {
  const m = sim.metrics();
  const s = sim.signals.status(sim.time);
  let onRoad = 0;
  for (const _ of sim.vehicles()) onRoad++;
  const rows: [string, string][] = [
    ['Time', formatTime(sim.time)],
    ['Phase', `${s.phase + 1} · ${s.stage} · ${Math.ceil(s.remaining)} s`],
    ['Vehicles on road', String(onRoad)],
    ['Queued upstream', String(sim.backlogSize())],
    ['Completed', String(m.completed)],
    ['Avg delay', `${m.avgDelay.toFixed(1)} s`],
    ['Avg stops', m.avgStops.toFixed(2)],
    ['Max queue', `${m.maxQueue} veh`],
    ['Throughput', `${Math.round(m.throughput)} veh/h`],
  ];
  statsList.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  highlightActivePhase();
}

function formatTime(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderStaticSidebar(): void {
  errorsList.replaceChildren(
    ...ix.errors.map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return li;
    }),
  );

  phasesList.replaceChildren(
    ...ix.phaseSets.map((set, index) => {
      const li = document.createElement('li');
      li.append(...set.map((m) => chip(ix.movements[m].id)));
      if (selection.kind === 'phase' && selection.index === index) li.classList.add('selected');
      li.onclick = () => select({ kind: 'phase', index });
      return li;
    }),
  );

  const table = document.createElement('table');
  table.className = 'matrix';
  const head = table.insertRow();
  head.appendChild(document.createElement('th'));
  const header = (id: MovementId) => {
    const th = document.createElement('th');
    th.textContent = id;
    if (selection.kind === 'movement' && selection.id === id) th.classList.add('selected');
    th.onclick = () => select({ kind: 'movement', id });
    return th;
  };
  for (const m of ix.movements) head.appendChild(header(m.id));
  ix.movements.forEach((a, i) => {
    const row = table.insertRow();
    row.appendChild(header(a.id));
    ix.movements.forEach((b, j) => {
      const td = row.insertCell();
      td.className = i === j ? 'self' : ix.conflicts[i][j] ? 'x' : 'ok';
      td.title = `${a.id} × ${b.id}: ${i === j ? '—' : ix.conflicts[i][j] ? 'conflict' : 'compatible'}`;
    });
  });
  matrixDiv.replaceChildren(table);
}

// --- canvas ----------------------------------------------------------------

function pathStyle(id: MovementId): PathStyle {
  if (selection.kind === 'phase') {
    const set = ix.phaseSets[selection.index];
    return set.some((m) => ix.movements[m].id === id) ? 'strong' : 'hidden';
  }
  if (selection.kind === 'movement') {
    const selected = selection.id;
    if (id === selected) return 'strong';
    const i = ix.movements.findIndex((m) => m.id === selected);
    const j = ix.movements.findIndex((m) => m.id === id);
    return ix.conflicts[i][j] ? 'conflict' : 'hidden';
  }
  return 'hidden';
}

function draw(): void {
  const { width, height } = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  drawIntersection(ctx, width, height, ix, { pathStyle, extent });
  drawSignals(ctx, sim);
  drawVehicles(ctx, sim, playing ? Math.min(accumulator / sim.dt, 1) : 1);
  drawBacklog(ctx, sim, extent);
}

function frame(now: number): void {
  if (playing) {
    const elapsed = Math.min((now - lastFrame) / 1000, 0.25);
    accumulator += elapsed * Number(speedSelect.value);
    let steps = 0;
    while (accumulator >= sim.dt && steps < MAX_STEPS_PER_FRAME) {
      sim.step();
      accumulator -= sim.dt;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    if (now - lastStats > 250) {
      renderStats();
      lastStats = now;
    }
  }
  lastFrame = now;
  draw();
  requestAnimationFrame(frame);
}

// --- wiring ----------------------------------------------------------------

PRESETS.forEach((p, i) => presetSelect.add(new Option(p.name, String(i))));
presetSelect.onchange = () => loadConfig(PRESETS[Number(presetSelect.value)]);
playButton.onclick = () => setPlaying(!playing);
$<HTMLButtonElement>('step').onclick = () => {
  setPlaying(false);
  sim.step();
  renderStats();
};
$<HTMLButtonElement>('restart').onclick = () => restart();
$<HTMLButtonElement>('reset-plan').onclick = () => {
  plan = simplePlan(ix);
  restart();
};
seedInput.onchange = () => restart();
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const max = ix.halfSize + ix.approachLength + EXIT_LENGTH / 4;
    extent = Math.min(max, Math.max(ix.halfSize + 5, extent * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

loadConfig(PRESETS[0]);
requestAnimationFrame(frame);
