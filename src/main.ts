import { compile, type CompiledIntersection } from './model/intersection';
import { PRESETS } from './model/presets';
import type { IntersectionConfig, MovementId } from './model/types';
import { ARM_COLORS, drawIntersection, type PathStyle } from './ui/render';
import './style.css';

type Selection = { kind: 'none' } | { kind: 'phase'; index: number } | { kind: 'movement'; id: MovementId };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const presetSelect = $<HTMLSelectElement>('preset');
const errorsList = $<HTMLUListElement>('errors');
const phasesList = $<HTMLOListElement>('phases');
const matrixDiv = $<HTMLDivElement>('matrix');
const stage = $<HTMLDivElement>('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

let ix: CompiledIntersection;
let selection: Selection = { kind: 'none' };

function load(config: IntersectionConfig): void {
  ix = compile(structuredClone(config));
  selection = { kind: 'none' };
  renderSidebar();
  draw();
}

function chip(id: MovementId): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = id;
  span.style.background = ARM_COLORS[id[0] as keyof typeof ARM_COLORS];
  return span;
}

function select(next: Selection): void {
  const same =
    (next.kind === 'phase' && selection.kind === 'phase' && next.index === selection.index) ||
    (next.kind === 'movement' && selection.kind === 'movement' && next.id === selection.id);
  selection = same ? { kind: 'none' } : next;
  renderSidebar();
  draw();
}

function renderSidebar(): void {
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

function pathStyle(id: MovementId): PathStyle {
  if (selection.kind === 'phase') {
    const set = ix.phaseSets[selection.index];
    return set.some((m) => ix.movements[m].id === id) ? 'strong' : 'faint';
  }
  if (selection.kind === 'movement') {
    const selected = selection.id;
    if (id === selected) return 'strong';
    const i = ix.movements.findIndex((m) => m.id === selected);
    const j = ix.movements.findIndex((m) => m.id === id);
    return ix.conflicts[i][j] ? 'conflict' : 'faint';
  }
  return 'normal';
}

function draw(): void {
  const { width, height } = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  drawIntersection(ctx, width, height, ix, { pathStyle });
}

PRESETS.forEach((p, i) => presetSelect.add(new Option(p.name, String(i))));
presetSelect.onchange = () => load(PRESETS[Number(presetSelect.value)]);
new ResizeObserver(() => ix && draw()).observe(stage);
load(PRESETS[0]);
