import { add, ARM_UNIT, armPoint, inboundLanePoint, rightOf, scale, type Vec } from '../model/geometry';
import type { CompiledIntersection, LanePath } from '../model/intersection';
import type { ArmId, MovementId, Turn } from '../model/types';

export type PathStyle = 'normal' | 'strong' | 'conflict' | 'faint' | 'hidden';

export interface RenderOptions {
  pathStyle?: (movement: MovementId) => PathStyle;
  /** Metres from the centre to the edge of the view (defaults to box + 30 m). */
  extent?: number;
}

const COLORS = {
  grass: '#2f3b2f',
  asphalt: '#3c4046',
  box: '#43474e',
  lane: '#d9d9d9',
  centre: '#e8c547',
  stop: '#ffffff',
  arrow: '#e6e6e6',
  conflict: '#ff4d4d',
};

export const ARM_COLORS: Record<ArmId, string> = {
  N: '#f4845f',
  E: '#4cc9a6',
  S: '#f6d55c',
  W: '#7aa7ff',
};

/** Approach length shown around the box by default; the rest of the approach is off-screen. */
const VIEW_MARGIN = 30;

export function defaultExtent(ix: CompiledIntersection): number {
  return ix.halfSize + Math.min(ix.approachLength, VIEW_MARGIN);
}

/** Metres → CSS pixels for a canvas of the given size. */
export function worldScale(width: number, height: number, extent: number): number {
  return (Math.min(width, height) / (2 * extent)) * 0.98;
}

export function drawIntersection(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ix: CompiledIntersection,
  opts: RenderOptions = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, width, height);

  const k = worldScale(width, height, opts.extent ?? defaultExtent(ix));
  ctx.setTransform(dpr * k, 0, 0, dpr * k, (dpr * width) / 2, (dpr * height) / 2);

  const h = ix.halfSize;
  const far = h + ix.approachLength;
  const w = ix.laneWidth;

  // Road surfaces.
  ctx.fillStyle = COLORS.asphalt;
  for (const arm of ix.enabledArms) {
    const a = ix.config.arms[arm];
    polygon(ctx, [
      armPoint(arm, h, -a.outLanes * w),
      armPoint(arm, far, -a.outLanes * w),
      armPoint(arm, far, a.inLanes * w),
      armPoint(arm, h, a.inLanes * w),
    ]);
    ctx.fill();
  }
  ctx.fillStyle = COLORS.box;
  ctx.fillRect(-h, -h, 2 * h, 2 * h);

  // Markings.
  for (const arm of ix.enabledArms) {
    const a = ix.config.arms[arm];
    ctx.setLineDash([]);
    ctx.lineWidth = 0.15;
    ctx.strokeStyle = COLORS.lane;
    line(ctx, armPoint(arm, h, -a.outLanes * w), armPoint(arm, far, -a.outLanes * w));
    line(ctx, armPoint(arm, h, a.inLanes * w), armPoint(arm, far, a.inLanes * w));

    ctx.strokeStyle = COLORS.centre;
    line(ctx, armPoint(arm, h, -0.12), armPoint(arm, far, -0.12));
    line(ctx, armPoint(arm, h, 0.12), armPoint(arm, far, 0.12));

    ctx.strokeStyle = COLORS.lane;
    ctx.setLineDash([3, 3]);
    for (let i = 1; i < a.inLanes; i++) line(ctx, armPoint(arm, h, i * w), armPoint(arm, far, i * w));
    for (let i = 1; i < a.outLanes; i++) line(ctx, armPoint(arm, h, -i * w), armPoint(arm, far, -i * w));
    ctx.setLineDash([]);

    ctx.strokeStyle = COLORS.stop;
    ctx.lineWidth = 0.5;
    line(ctx, armPoint(arm, h + 0.25, 0.25), armPoint(arm, h + 0.25, a.inLanes * w));

    a.laneTurns.forEach((turns, lane) => drawLaneArrow(ctx, arm, lane, turns, h + 7, w));
  }

  // Movement paths.
  const style = opts.pathStyle ?? (() => 'normal' as const);
  const order: PathStyle[] = ['faint', 'normal', 'conflict', 'strong'];
  for (const s of order) {
    for (const p of ix.paths) if (style(p.movement) === s) drawPath(ctx, p, s);
  }
}

function drawPath(ctx: CanvasRenderingContext2D, p: LanePath, s: PathStyle): void {
  const color = s === 'conflict' ? COLORS.conflict : ARM_COLORS[p.from];
  ctx.strokeStyle = color;
  ctx.globalAlpha = s === 'faint' ? 0.15 : s === 'normal' ? 0.55 : 1;
  ctx.lineWidth = s === 'strong' ? 0.7 : s === 'conflict' ? 0.5 : 0.35;
  ctx.setLineDash(s === 'conflict' ? [1.2, 0.8] : []);
  const { p0, p1, p2 } = p.curve;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();

  if (s === 'strong' || s === 'normal') {
    // Arrow head at the exit.
    const d = ARM_UNIT[p.to];
    const r = rightOf(d);
    const tip = add(p2, scale(d, 1.2));
    ctx.fillStyle = color;
    polygon(ctx, [tip, add(p2, scale(r, 0.7)), add(p2, scale(r, -0.7))]);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** Painted road arrow for one inbound lane, `dist` metres from the centre. */
function drawLaneArrow(
  ctx: CanvasRenderingContext2D,
  arm: ArmId,
  lane: number,
  turns: readonly Turn[],
  dist: number,
  laneWidth: number,
): void {
  const base = inboundLanePoint(arm, lane, dist, laneWidth);
  const fwd = scale(ARM_UNIT[arm], -1);
  const right = rightOf(fwd);
  const at = (f: number, s: number): Vec => add(base, add(scale(fwd, f), scale(right, s)));

  ctx.strokeStyle = COLORS.arrow;
  ctx.fillStyle = COLORS.arrow;
  ctx.lineWidth = 0.25;
  ctx.globalAlpha = 0.8;
  line(ctx, at(-2.5, 0), at(0, 0));
  for (const t of turns) {
    if (t === 'S') {
      line(ctx, at(0, 0), at(1.6, 0));
      polygon(ctx, [at(2.6, 0), at(1.5, -0.5), at(1.5, 0.5)]);
    } else {
      const side = t === 'L' ? -1 : 1;
      line(ctx, at(0, 0), at(0.6, side * 0.8));
      polygon(ctx, [at(0.9, side * 1.6), at(0.2, side * 0.9), at(1.0, side * 0.6)]);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function polygon(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}
