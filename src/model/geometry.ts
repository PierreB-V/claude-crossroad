import { ARMS, type ArmId, type Turn } from './types';

/**
 * World coordinates are metres, origin at the intersection centre,
 * x towards East, y towards South (same orientation as the canvas).
 */
export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const length = (a: Vec): number => Math.hypot(a.x, a.y);
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;

/** Unit vector pointing from the centre outwards along each arm. */
export const ARM_UNIT: Record<ArmId, Vec> = {
  N: vec(0, -1),
  E: vec(1, 0),
  S: vec(0, 1),
  W: vec(-1, 0),
};

export const ARM_INDEX: Record<ArmId, number> = { N: 0, E: 1, S: 2, W: 3 };

/** Right-hand side of a heading (y down). */
export const rightOf = (d: Vec): Vec => vec(-d.y, d.x);

const TURN_STEP: Record<Turn, number> = { L: 1, S: 2, R: 3 };

/** Arm a vehicle leaves through when it enters from `from` and performs `turn` (right-hand traffic). */
export function targetArm(from: ArmId, turn: Turn): ArmId {
  return ARMS[(ARM_INDEX[from] + TURN_STEP[turn]) % 4];
}

/**
 * Point on an arm at `dist` metres from the centre and `lateral` metres from the
 * road centre line, measured towards the inbound side.
 */
export function armPoint(arm: ArmId, dist: number, lateral: number): Vec {
  const u = ARM_UNIT[arm];
  const r = rightOf(scale(u, -1));
  return add(scale(u, dist), scale(r, lateral));
}

/** Centre of inbound lane `lane` (0 = leftmost) at `dist` from the centre. */
export function inboundLanePoint(arm: ArmId, lane: number, dist: number, laneWidth: number): Vec {
  return armPoint(arm, dist, (lane + 0.5) * laneWidth);
}

/** Centre of outbound lane `lane` (0 = innermost) at `dist` from the centre. */
export function outboundLanePoint(arm: ArmId, lane: number, dist: number, laneWidth: number): Vec {
  return armPoint(arm, dist, -(lane + 0.5) * laneWidth);
}

export interface QuadBezier {
  p0: Vec;
  p1: Vec;
  p2: Vec;
}

export function bezierPoint(c: QuadBezier, t: number): Vec {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const d = t * t;
  return vec(a * c.p0.x + b * c.p1.x + d * c.p2.x, a * c.p0.y + b * c.p1.y + d * c.p2.y);
}

export function bezierTangent(c: QuadBezier, t: number): Vec {
  return add(scale(sub(c.p1, c.p0), 2 * (1 - t)), scale(sub(c.p2, c.p1), 2 * t));
}

export function bezierLength(c: QuadBezier, segments = 32): number {
  let total = 0;
  let prev = c.p0;
  for (let i = 1; i <= segments; i++) {
    const p = bezierPoint(c, i / segments);
    total += length(sub(p, prev));
    prev = p;
  }
  return total;
}

/**
 * Quadratic curve leaving `start` with heading `dIn` and arriving at `end` with heading `dOut`.
 * The control point is where the two heading lines meet (midpoint when they are parallel).
 */
export function turnCurve(start: Vec, dIn: Vec, end: Vec, dOut: Vec): QuadBezier {
  const denom = cross(dIn, dOut);
  if (Math.abs(denom) < 1e-9) {
    return { p0: start, p1: scale(add(start, end), 0.5), p2: end };
  }
  const s = cross(sub(end, start), dOut) / denom;
  return { p0: start, p1: add(start, scale(dIn, s)), p2: end };
}
