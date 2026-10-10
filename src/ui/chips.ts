import type { MovementId } from '../model/types';
import { MAX_GREEN, MIN_GREEN, type SignalPlan } from '../sim/signal';
import { ARM_COLORS } from './render';

export function chip(id: MovementId): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = id;
  span.style.background = ARM_COLORS[id[0] as keyof typeof ARM_COLORS];
  return span;
}

/**
 * Renders a plan as a list of phases. With `onGreenChange` the green times are editable.
 */
export function renderPlanList(
  target: HTMLOListElement,
  plan: SignalPlan,
  onGreenChange?: (phase: number, green: number) => void,
): void {
  target.replaceChildren(
    ...plan.phases.map((phase, index) => {
      const li = document.createElement('li');
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...phase.movements.map(chip));
      li.append(chips);
      if (onGreenChange) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(MIN_GREEN);
        input.max = String(MAX_GREEN);
        input.value = String(phase.green);
        input.title = 'Green time (s)';
        input.onchange = () => {
          const g = Math.round(Number(input.value));
          onGreenChange(index, Math.min(MAX_GREEN, Math.max(MIN_GREEN, Number.isFinite(g) ? g : MIN_GREEN)));
        };
        li.append(input, document.createTextNode('s'));
      } else {
        li.append(document.createTextNode(`${phase.green} s`));
      }
      return li;
    }),
  );
}

export function definitionList(target: HTMLDListElement, rows: [string, string][]): void {
  target.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}
