import {
  ARM_UNIT,
  armPoint,
  bezierPoint,
  bezierTangent,
  inboundLanePoint,
  length,
  outboundLanePoint,
  scale,
  sub,
} from '../model/geometry';
import type { CompiledIntersection } from '../model/intersection';
import type { ArmId } from '../model/types';
import type { Route, Simulation } from '../sim/engine';
import { IDM } from '../sim/idm';
import type { Light } from '../sim/signal';

const LIGHT_COLORS: Record<Light, string> = { G: '#3ddc84', Y: '#ffc23d', R: '#ff4d4d' };
const VEHICLE_WIDTH = 1.9;
/** Waiting time (s) at which a vehicle is drawn fully red. */
const WAIT_SCALE = 60;

interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Arc-length tables so vehicles move at a uniform speed along the curved box paths. */
const arcTables = new WeakMap<Route, Float64Array>();
const ARC_SAMPLES = 32;

function arcTable(route: Route): Float64Array {
  let table = arcTables.get(route);
  if (!table) {
    table = new Float64Array(ARC_SAMPLES + 1);
    let prev = route.path.curve.p0;
    for (let i = 1; i <= ARC_SAMPLES; i++) {
      const p = bezierPoint(route.path.curve, i / ARC_SAMPLES);
      table[i] = table[i - 1] + length(sub(p, prev));
      prev = p;
    }
    arcTables.set(route, table);
  }
  return table;
}

function curveParam(route: Route, s: number): number {
  const table = arcTable(route);
  const target = Math.min(Math.max(s, 0), table[ARC_SAMPLES]);
  let i = 1;
  while (i < ARC_SAMPLES && table[i] < target) i++;
  const span = table[i] - table[i - 1] || 1;
  return (i - 1 + (target - table[i - 1]) / span) / ARC_SAMPLES;
}

/** World position and heading of the vehicle centre when its front bumper is at `d`. */
export function vehiclePose(ix: CompiledIntersection, route: Route, d: number): Pose {
  const centre = d - IDM.length / 2;
  const p = route.path;
  if (centre < route.inLen) {
    const pos = inboundLanePoint(p.from, p.lane, ix.halfSize + route.inLen - centre, ix.laneWidth);
    const dir = scale(ARM_UNIT[p.from], -1);
    return { ...pos, angle: Math.atan2(dir.y, dir.x) };
  }
  if (centre < route.inLen + route.pathLen) {
    const t = curveParam(route, centre - route.inLen);
    const pos = bezierPoint(p.curve, t);
    const dir = bezierTangent(p.curve, t);
    return { ...pos, angle: Math.atan2(dir.y, dir.x) };
  }
  const pos = outboundLanePoint(p.to, p.exitLane, ix.halfSize + centre - route.inLen - route.pathLen, ix.laneWidth);
  const dir = ARM_UNIT[p.to];
  return { ...pos, angle: Math.atan2(dir.y, dir.x) };
}

function waitColor(stoppedTime: number): string {
  const k = Math.min(stoppedTime / WAIT_SCALE, 1);
  return `hsl(${Math.round(190 - 190 * k)}, 75%, ${Math.round(62 - 8 * k)}%)`;
}

/** Draws vehicles, interpolated between the last two simulation steps by `alpha` ∈ [0, 1]. */
export function drawVehicles(ctx: CanvasRenderingContext2D, sim: Simulation, alpha: number): void {
  for (const v of sim.vehicles()) {
    const d = v.prevD + (v.d - v.prevD) * alpha;
    const pose = vehiclePose(sim.ix, v.route, d);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    ctx.fillStyle = waitColor(v.stoppedTime);
    roundRect(ctx, -IDM.length / 2, -VEHICLE_WIDTH / 2, IDM.length, VEHICLE_WIDTH, 0.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(IDM.length / 2 - 1.6, -VEHICLE_WIDTH / 2 + 0.25, 0.7, VEHICLE_WIDTH - 0.5);
    ctx.restore();
  }
}

/** One light per (lane, turn) just behind the stop line. */
export function drawSignals(ctx: CanvasRenderingContext2D, sim: Simulation): void {
  const ix = sim.ix;
  const w = ix.laneWidth;
  for (const arm of ix.enabledArms) {
    ix.config.arms[arm].laneTurns.forEach((turns, lane) => {
      turns.forEach((turn, k) => {
        const m = ix.movements.findIndex((mv) => mv.from === arm && mv.turn === turn);
        if (m < 0) return;
        const slot = w / turns.length;
        const lateral = lane * w + slot * (k + 0.5);
        const pos = armPoint(arm, ix.halfSize + 1.2, lateral);
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.min(0.75, slot * 0.4) + 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = LIGHT_COLORS[sim.lights[m]];
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.min(0.75, slot * 0.4), 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }
}

/** "+N" label at the upstream end of approaches whose queue overflows the modelled road. */
export function drawBacklog(ctx: CanvasRenderingContext2D, sim: Simulation, viewExtent: number): void {
  const ix = sim.ix;
  const lanesOfArm = new Map<ArmId, Set<number>>();
  for (const r of sim.routes) {
    if (!lanesOfArm.has(r.path.from)) lanesOfArm.set(r.path.from, new Set());
    lanesOfArm.get(r.path.from)!.add(r.inbound);
  }
  ctx.font = 'bold 2.6px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [arm, lanes] of lanesOfArm) {
    let n = 0;
    for (const i of lanes) n += sim.backlog[i].length;
    if (n === 0) continue;
    const dist = Math.min(ix.halfSize + ix.approachLength, viewExtent) - 3;
    const pos = armPoint(arm, dist, (ix.config.arms[arm].inLanes * ix.laneWidth) / 2);
    const text = `+${n}`;
    const wText = ctx.measureText(text).width + 1.6;
    ctx.fillStyle = 'rgba(255,77,77,0.9)';
    roundRect(ctx, pos.x - wText / 2, pos.y - 1.9, wText, 3.8, 0.8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, pos.x, pos.y + 0.1);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
