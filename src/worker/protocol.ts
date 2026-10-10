import type { Evaluation, EvaluationSettings } from '../ga/fitness';
import type { IntersectionConfig } from '../model/types';
import type { SignalPlan } from '../sim/signal';

export type WorkerRequest =
  | { type: 'context'; config: IntersectionConfig; settings: EvaluationSettings }
  | { type: 'evaluate'; id: number; plans: SignalPlan[] };

export interface WorkerResponse {
  id: number;
  results: Evaluation[];
}
