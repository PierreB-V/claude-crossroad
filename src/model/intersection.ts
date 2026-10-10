import { conflictMatrix } from './conflicts';
import {
  ARM_UNIT,
  bezierLength,
  inboundLanePoint,
  outboundLanePoint,
  scale,
  targetArm,
  turnCurve,
  type QuadBezier,
} from './geometry';
import { defaultLaneTurns, exitLaneFor, lanesAreOrdered } from './lanes';
import { maximalCompatibleSets } from './phases';
import {
  ARMS,
  MAX_LANES,
  MIN_LANES,
  TURNS,
  type ArmId,
  type IntersectionConfig,
  type MovementId,
  type Turn,
} from './types';

export const LANE_WIDTH = 3.5;
export const APPROACH_LENGTH = 80;

export interface Movement {
  id: MovementId;
  index: number;
  from: ArmId;
  turn: Turn;
  to: ArmId;
  /** Vehicles per hour. */
  demand: number;
  /** Inbound lanes (on `from`) that allow this movement. */
  lanes: number[];
  /** Outbound lanes (on `to`) used by this movement. */
  exitLanes: number[];
}

export interface LanePath {
  movement: MovementId;
  from: ArmId;
  lane: number;
  to: ArmId;
  exitLane: number;
  /** From the stop line to the edge of the box on the exit arm. */
  curve: QuadBezier;
  length: number;
}

export interface CompiledIntersection {
  config: IntersectionConfig;
  laneWidth: number;
  /** Half side of the square conflict box, in metres. */
  halfSize: number;
  approachLength: number;
  enabledArms: ArmId[];
  movements: Movement[];
  paths: LanePath[];
  /** conflicts[i][j] for movements[i], movements[j]. */
  conflicts: boolean[][];
  /** Maximal compatible movement sets (indices into `movements`). */
  phaseSets: number[][];
  errors: string[];
}

export function availableTurns(config: IntersectionConfig, arm: ArmId): Turn[] {
  return TURNS.filter((t) => config.arms[targetArm(arm, t)].enabled);
}

/** Returns a copy with lane turns regenerated from defaults for every enabled arm. */
export function withDefaultLaneTurns(config: IntersectionConfig): IntersectionConfig {
  const copy = structuredClone(config);
  for (const arm of ARMS) {
    const a = copy.arms[arm];
    a.laneTurns = a.enabled ? defaultLaneTurns(availableTurns(copy, arm), a.inLanes) : [];
  }
  return copy;
}

export function validate(config: IntersectionConfig): string[] {
  const errors: string[] = [];
  const enabled = ARMS.filter((a) => config.arms[a].enabled);
  if (enabled.length < 3) errors.push('At least 3 arms must be enabled.');

  for (const arm of enabled) {
    const a = config.arms[arm];
    const possible = availableTurns(config, arm);
    for (const [label, n] of [['inbound', a.inLanes], ['outbound', a.outLanes]] as const) {
      if (!Number.isInteger(n) || n < MIN_LANES || n > MAX_LANES)
        errors.push(`${arm}: ${label} lanes must be between ${MIN_LANES} and ${MAX_LANES}.`);
    }
    if (a.laneTurns.length !== a.inLanes)
      errors.push(`${arm}: ${a.inLanes} inbound lanes but ${a.laneTurns.length} lane turn definitions.`);
    a.laneTurns.forEach((turns, i) => {
      if (turns.length === 0) errors.push(`${arm}: lane ${i + 1} allows no movement.`);
      for (const t of turns)
        if (!possible.includes(t)) errors.push(`${arm}: lane ${i + 1} turns ${t} towards a disabled arm.`);
    });
    if (!lanesAreOrdered(a.laneTurns)) errors.push(`${arm}: lane movements cross each other.`);
    for (const t of possible) {
      if (a.demand[t] < 0) errors.push(`${arm}${t}: demand cannot be negative.`);
      if (a.demand[t] > 0 && !a.laneTurns.some((lt) => lt.includes(t)))
        errors.push(`${arm}${t}: has demand but no lane allows it.`);
    }
  }
  return errors;
}

export function compile(config: IntersectionConfig): CompiledIntersection {
  const errors = validate(config);
  const laneWidth = LANE_WIDTH;
  const enabledArms = ARMS.filter((a) => config.arms[a].enabled);
  const widest = Math.max(1, ...enabledArms.map((a) => Math.max(config.arms[a].inLanes, config.arms[a].outLanes)));
  const halfSize = widest * laneWidth + 1;

  const movements: Movement[] = [];
  const paths: LanePath[] = [];

  for (const from of enabledArms) {
    const arm = config.arms[from];
    for (const turn of availableTurns(config, from)) {
      const lanes = arm.laneTurns.flatMap((turns, i) => (turns.includes(turn) ? [i] : []));
      if (lanes.length === 0) continue;
      const to = targetArm(from, turn);
      const outLanes = config.arms[to].outLanes;
      const id = `${from}${turn}` as MovementId;
      const exitLanes: number[] = [];

      lanes.forEach((lane, rank) => {
        const exitLane = exitLaneFor(turn, rank, lanes.length, outLanes);
        if (!exitLanes.includes(exitLane)) exitLanes.push(exitLane);
        const curve = turnCurve(
          inboundLanePoint(from, lane, halfSize, laneWidth),
          scale(ARM_UNIT[from], -1),
          outboundLanePoint(to, exitLane, halfSize, laneWidth),
          ARM_UNIT[to],
        );
        paths.push({ movement: id, from, lane, to, exitLane, curve, length: bezierLength(curve) });
      });

      movements.push({
        id,
        index: movements.length,
        from,
        turn,
        to,
        demand: Math.max(0, arm.demand[turn] ?? 0),
        lanes,
        exitLanes: exitLanes.sort((a, b) => a - b),
      });
    }
  }

  const conflicts = conflictMatrix(movements);
  const phaseSets = maximalCompatibleSets(conflicts);

  return {
    config,
    laneWidth,
    halfSize,
    approachLength: APPROACH_LENGTH,
    enabledArms,
    movements,
    paths,
    conflicts,
    phaseSets,
    errors,
  };
}
