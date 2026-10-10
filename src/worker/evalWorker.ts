/// <reference lib="webworker" />
import { evaluatePlan, type EvaluationSettings } from '../ga/fitness';
import { compile, type CompiledIntersection } from '../model/intersection';
import type { WorkerRequest, WorkerResponse } from './protocol';

let ix: CompiledIntersection | null = null;
let settings: EvaluationSettings | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'context') {
    ix = compile(msg.config);
    settings = msg.settings;
    return;
  }
  if (!ix || !settings) throw new Error('Worker received plans before its context.');
  const results = msg.plans.map((plan) => evaluatePlan(ix!, plan, settings!));
  const response: WorkerResponse = { id: msg.id, results };
  self.postMessage(response);
};
