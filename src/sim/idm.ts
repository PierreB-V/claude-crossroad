/** Intelligent Driver Model parameters (urban car). */
export const IDM = {
  /** Desired speed on straight road, m/s (50 km/h). */
  v0: 13.9,
  /** Desired time headway, s. */
  T: 1.2,
  /** Maximum acceleration, m/s². */
  a: 1.5,
  /** Comfortable deceleration, m/s². */
  b: 2.0,
  /** Minimum bumper-to-bumper gap, m. */
  s0: 2.0,
  /** Vehicle length, m. */
  length: 4.5,
  /** Hardest braking we allow, m/s². */
  maxBrake: 9,
} as const;

/** Turning speeds inside the box, m/s. */
export const TURN_SPEED = { L: 8, S: IDM.v0, R: 6 } as const;

/**
 * IDM acceleration for a vehicle at speed `v` with desired speed `v0`,
 * bumper-to-bumper `gap` to a leader driving at `vLead` (gap = Infinity when free).
 */
export function idmAcceleration(v: number, v0: number, gap: number, vLead: number): number {
  const free = 1 - Math.pow(v / v0, 4);
  if (!Number.isFinite(gap)) return Math.max(-IDM.maxBrake, IDM.a * free);
  const sStar = IDM.s0 + Math.max(0, v * IDM.T + (v * (v - vLead)) / (2 * Math.sqrt(IDM.a * IDM.b)));
  const interaction = Math.pow(sStar / Math.max(gap, 0.1), 2);
  return Math.max(-IDM.maxBrake, IDM.a * (free - interaction));
}

/** Highest speed from which a vehicle can still slow to `vTarget` within `dist` at comfortable braking. */
export function approachSpeedLimit(vTarget: number, dist: number): number {
  return Math.sqrt(vTarget * vTarget + 2 * IDM.b * Math.max(0, dist));
}
