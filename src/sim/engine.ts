import type { CompiledIntersection, LanePath } from '../model/intersection';
import { approachSpeedLimit, IDM, idmAcceleration, TURN_SPEED } from './idm';
import { Rng } from './rng';
import { SignalController, type Light, type SignalPlan } from './signal';

/** Length of the outbound lane after the box before vehicles leave the model, m. */
export const EXIT_LENGTH = 40;
export const DEFAULT_DT = 0.5;

/** Speed under which a vehicle counts as stopped / queued, m/s. */
const STOP_SPEED = 0.5;
const MOVING_SPEED = 2;
/** Above this deceleration a driver seeing yellow goes through instead of stopping, m/s². */
const YELLOW_STOP_DECEL = 3.5;
/** Distance into the box over which paths leaving the same lane still overlap, m. */
const SHARED_ENTRY = 8;

/** One way through the intersection: inbound lane → box path → outbound lane. */
export interface Route {
  index: number;
  path: LanePath;
  movement: number;
  inLen: number;
  pathLen: number;
  exitLen: number;
  total: number;
  turnSpeed: number;
  /** Travel time without any interaction, s. */
  freeFlowTime: number;
  inbound: number;
  exit: number;
}

export interface Vehicle {
  id: number;
  route: Route;
  /** Distance of the front bumper along the route, m. */
  d: number;
  /** Value of `d` before the last step (for smooth rendering). */
  prevD: number;
  v: number;
  /** Time the vehicle arrived at the end of the queue (or the approach), s. */
  arrival: number;
  stops: number;
  stoppedTime: number;
  moving: boolean;
  /** Decision taken at yellow onset: true = go, false = stop, null = not decided. */
  yellowGo: boolean | null;
}

export interface SimOptions {
  seed: number;
  dt?: number;
  /** Seconds at the start excluded from metrics. */
  warmup?: number;
}

export interface Metrics {
  time: number;
  /** Vehicles that arrived after warm-up. */
  measured: number;
  completed: number;
  /** Measured vehicles still in the system. */
  unserved: number;
  /** Average delay of measured vehicles, s (still-waiting vehicles count with their delay so far). */
  avgDelay: number;
  avgStops: number;
  /** Completed vehicles per hour over the measured window. */
  throughput: number;
  /** Longest queue seen on any inbound lane after warm-up, vehicles. */
  maxQueue: number;
}

interface Container {
  vehicles: Vehicle[];
}

export class Simulation {
  readonly dt: number;
  readonly warmup: number;
  readonly signals: SignalController;
  readonly routes: Route[];
  time = 0;
  lights: Light[] = [];

  /** Per inbound lane (index from `laneIndex`): vehicles on the approach, front first. */
  readonly inbound: Container[];
  /** Vehicles that arrived but have no room on the approach yet (virtual queue upstream). */
  readonly backlog: Vehicle[][];
  /** Per route: vehicles inside the box. */
  readonly box: Container[];
  /** Per outbound lane: vehicles after the box, front first. */
  readonly exit: Container[];

  private readonly rng: Rng;
  private readonly nextArrival: number[];
  private readonly routesByMovementLane = new Map<string, Route>();
  private readonly routesByInbound: Route[][];
  private nextId = 1;

  private measured = 0;
  private completed = 0;
  private completedDelay = 0;
  private completedStops = 0;
  private maxQueue = 0;

  constructor(
    readonly ix: CompiledIntersection,
    readonly plan: SignalPlan,
    opts: SimOptions,
  ) {
    this.dt = opts.dt ?? DEFAULT_DT;
    this.warmup = opts.warmup ?? 0;
    this.rng = new Rng(opts.seed);
    this.signals = new SignalController(plan, ix.movements.map((m) => m.id));

    const inboundIds: string[] = [];
    const exitIds: string[] = [];
    const indexOf = (list: string[], key: string) => {
      let i = list.indexOf(key);
      if (i < 0) i = list.push(key) - 1;
      return i;
    };

    this.routes = ix.paths.map((path, index) => {
      const movement = ix.movements.findIndex((m) => m.id === path.movement);
      const turnSpeed = TURN_SPEED[ix.movements[movement].turn];
      const route: Route = {
        index,
        path,
        movement,
        inLen: ix.approachLength,
        pathLen: path.length,
        exitLen: EXIT_LENGTH,
        total: ix.approachLength + path.length + EXIT_LENGTH,
        turnSpeed,
        freeFlowTime: (ix.approachLength + EXIT_LENGTH) / IDM.v0 + path.length / turnSpeed,
        inbound: indexOf(inboundIds, `${path.from}${path.lane}`),
        exit: indexOf(exitIds, `${path.to}${path.exitLane}`),
      };
      this.routesByMovementLane.set(`${movement}:${path.lane}`, route);
      return route;
    });

    this.routesByInbound = inboundIds.map((_, i) => this.routes.filter((r) => r.inbound === i));
    this.inbound = inboundIds.map(() => ({ vehicles: [] }));
    this.backlog = inboundIds.map(() => []);
    this.box = this.routes.map(() => ({ vehicles: [] }));
    this.exit = exitIds.map(() => ({ vehicles: [] }));
    this.nextArrival = ix.movements.map((m) => (m.demand > 0 ? this.rng.exponential(m.demand / 3600) : Infinity));
    this.signals.lights(0, this.lights);
  }

  /** All vehicles currently drawn on the road (backlog excluded). */
  *vehicles(): Generator<Vehicle> {
    for (const c of this.inbound) yield* c.vehicles;
    for (const c of this.box) yield* c.vehicles;
    for (const c of this.exit) yield* c.vehicles;
  }

  backlogSize(): number {
    return this.backlog.reduce((n, b) => n + b.length, 0);
  }

  step(): void {
    const dt = this.dt;
    this.signals.lights(this.time, this.lights);
    this.spawnArrivals();
    this.admitBacklog();
    this.moveVehicles();
    this.transfer();
    this.time += dt;
    this.recordQueues();
  }

  run(duration: number): void {
    const steps = Math.round(duration / this.dt);
    for (let i = 0; i < steps; i++) this.step();
  }

  metrics(): Metrics {
    let delay = this.completedDelay;
    let stops = this.completedStops;
    let unserved = 0;
    const consider = (v: Vehicle) => {
      if (v.arrival < this.warmup) return;
      unserved++;
      delay += Math.max(0, this.time - v.arrival - v.d / IDM.v0);
      stops += v.stops;
    };
    for (const v of this.vehicles()) consider(v);
    for (const b of this.backlog) b.forEach(consider);
    const window = Math.max(this.time - this.warmup, 1e-9);
    return {
      time: this.time,
      measured: this.measured,
      completed: this.completed,
      unserved,
      avgDelay: this.measured > 0 ? delay / this.measured : 0,
      avgStops: this.measured > 0 ? stops / this.measured : 0,
      throughput: (this.completed / window) * 3600,
      maxQueue: this.maxQueue,
    };
  }

  // --- internals -----------------------------------------------------------

  private spawnArrivals(): void {
    const movements = this.ix.movements;
    for (let m = 0; m < movements.length; m++) {
      while (this.nextArrival[m] <= this.time) {
        const arrival = this.nextArrival[m];
        this.nextArrival[m] += this.rng.exponential(movements[m].demand / 3600);
        const route = this.pickRoute(m);
        const vehicle: Vehicle = {
          id: this.nextId++,
          route,
          d: 0,
          prevD: 0,
          v: IDM.v0,
          arrival,
          stops: 0,
          stoppedTime: 0,
          moving: true,
          yellowGo: null,
        };
        if (arrival >= this.warmup) this.measured++;
        this.backlog[route.inbound].push(vehicle);
      }
    }
  }

  /** Shortest queue among the lanes allowing the movement; random tie-break. */
  private pickRoute(movement: number): Route {
    const lanes = this.ix.movements[movement].lanes;
    let best: Route[] = [];
    let bestLoad = Infinity;
    for (const lane of lanes) {
      const route = this.routesByMovementLane.get(`${movement}:${lane}`)!;
      const load = this.inbound[route.inbound].vehicles.length + this.backlog[route.inbound].length;
      if (load < bestLoad) {
        best = [route];
        bestLoad = load;
      } else if (load === bestLoad) best.push(route);
    }
    return best.length === 1 ? best[0] : best[this.rng.int(best.length)];
  }

  private admitBacklog(): void {
    for (let i = 0; i < this.backlog.length; i++) {
      const queue = this.backlog[i];
      const lane = this.inbound[i].vehicles;
      while (queue.length > 0) {
        const last = lane[lane.length - 1];
        if (last && last.d < IDM.length + IDM.s0 + last.v * IDM.T) break;
        const v = queue.shift()!;
        if (last) v.v = Math.min(IDM.v0, last.v);
        lane.push(v);
      }
    }
  }

  private mayCross(v: Vehicle, distToLine: number): boolean {
    const light = this.lights[v.route.movement];
    if (light === 'G') {
      v.yellowGo = null;
      return true;
    }
    if (light === 'Y') {
      if (v.yellowGo === null) v.yellowGo = (v.v * v.v) / (2 * Math.max(distToLine, 0.1)) > YELLOW_STOP_DECEL;
      return v.yellowGo;
    }
    v.yellowGo = null;
    return false;
  }

  /** Front-bumper position of `v` within segment `seg` (0 approach, 1 box, 2 exit). */
  private posIn(v: Vehicle, seg: 0 | 1 | 2): number {
    const r = v.route;
    return seg === 0 ? v.d : seg === 1 ? v.d - r.inLen : v.d - r.inLen - r.pathLen;
  }

  /** Gap to whatever is ahead (leader vehicle or red light) and its speed. */
  private leader(v: Vehicle, seg: 0 | 1 | 2, ahead: Vehicle | undefined): [number, number] {
    const r = v.route;
    const pos = this.posIn(v, seg);
    if (ahead) return [this.posIn(ahead, seg) - IDM.length - pos, ahead.v];

    let dist = 0;
    if (seg === 0) {
      dist = r.inLen - pos;
      if (!this.mayCross(v, dist)) return [dist, 0];
      const last = this.lastEnteredFromLane(r);
      if (last) return [dist + this.posIn(last, 1) - IDM.length, last.v];
      dist += r.pathLen;
    } else if (seg === 1) {
      dist = r.pathLen - pos;
    } else {
      return [Infinity, 0];
    }
    const exitLane = this.exit[r.exit].vehicles;
    const last = exitLane[exitLane.length - 1];
    if (last) return [dist + this.posIn(last, 2) - IDM.length, last.v];
    return [Infinity, 0];
  }

  /**
   * Closest vehicle in the box that came from the same inbound lane: on our own path, or on
   * another path while the two paths still overlap near the stop line.
   */
  private lastEnteredFromLane(r: Route): Vehicle | undefined {
    const own = this.box[r.index].vehicles;
    let best = own[own.length - 1];
    for (const other of this.routesByInbound[r.inbound]) {
      if (other === r) continue;
      const list = this.box[other.index].vehicles;
      const last = list[list.length - 1];
      if (last && this.posIn(last, 1) < SHARED_ENTRY && (!best || this.posIn(last, 1) < this.posIn(best, 1)))
        best = last;
    }
    return best;
  }

  private moveVehicles(): void {
    const updates: [Vehicle, number, number][] = [];
    const plan = (c: Container, seg: 0 | 1 | 2) => {
      const list = c.vehicles;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        const r = v.route;
        const [gap, vLead] = this.leader(v, seg, list[i - 1]);
        let v0: number = IDM.v0;
        if (seg === 0) v0 = Math.min(v0, approachSpeedLimit(r.turnSpeed, r.inLen - v.d));
        else if (seg === 1) v0 = r.turnSpeed;
        const acc = idmAcceleration(v.v, v0, gap, vLead);
        let newV = v.v + acc * this.dt;
        let dd: number;
        if (newV <= 0) {
          dd = acc < 0 ? (v.v * v.v) / (-2 * acc) : 0;
          newV = 0;
        } else {
          dd = (v.v + newV) * 0.5 * this.dt;
        }
        // Never move into the leader or past a red stop line.
        if (Number.isFinite(gap) && dd > gap - 0.05) {
          dd = Math.max(0, gap - 0.05);
          newV = Math.min(newV, vLead);
        }
        updates.push([v, dd, newV]);
      }
    };
    this.inbound.forEach((c) => plan(c, 0));
    this.box.forEach((c) => plan(c, 1));
    this.exit.forEach((c) => plan(c, 2));

    for (const [v, dd, newV] of updates) {
      v.prevD = v.d;
      v.d += dd;
      v.v = newV;
      if (v.v < STOP_SPEED) {
        if (v.moving) v.stops++;
        v.moving = false;
        v.stoppedTime += this.dt;
      } else if (v.v > MOVING_SPEED) {
        v.moving = true;
      }
    }
    // Waiting in the virtual queue upstream counts as stopped.
    for (const queue of this.backlog) {
      for (const v of queue) {
        if (v.moving) v.stops++;
        v.moving = false;
        v.stoppedTime += this.dt;
      }
    }
  }

  private transfer(): void {
    for (const c of this.inbound) {
      while (c.vehicles.length > 0 && c.vehicles[0].d >= c.vehicles[0].route.inLen) {
        const v = c.vehicles.shift()!;
        this.box[v.route.index].vehicles.push(v);
      }
    }
    for (const c of this.box) {
      while (c.vehicles.length > 0 && c.vehicles[0].d >= c.vehicles[0].route.inLen + c.vehicles[0].route.pathLen) {
        const v = c.vehicles.shift()!;
        const lane = this.exit[v.route.exit].vehicles;
        // Keep the exit lane ordered front-first even when two box paths merge into it.
        let i = lane.length;
        while (i > 0 && this.posIn(lane[i - 1], 2) < this.posIn(v, 2)) i--;
        lane.splice(i, 0, v);
      }
    }
    for (const c of this.exit) {
      while (c.vehicles.length > 0 && c.vehicles[0].d >= c.vehicles[0].route.total) {
        const v = c.vehicles.shift()!;
        if (v.arrival >= this.warmup) {
          this.completed++;
          this.completedDelay += Math.max(0, this.time + this.dt - v.arrival - v.route.freeFlowTime);
          this.completedStops += v.stops;
        }
      }
    }
  }

  private recordQueues(): void {
    if (this.time < this.warmup) return;
    for (let i = 0; i < this.inbound.length; i++) {
      let q = this.backlog[i].length;
      for (const v of this.inbound[i].vehicles) if (v.v < MOVING_SPEED) q++;
      if (q > this.maxQueue) this.maxQueue = q;
    }
  }
}

export interface EvaluationOptions {
  seed: number;
  warmup?: number;
  duration?: number;
  dt?: number;
}

/** Runs a full headless simulation and returns its metrics. */
export function simulate(ix: CompiledIntersection, plan: SignalPlan, opts: EvaluationOptions): Metrics {
  const warmup = opts.warmup ?? 120;
  const sim = new Simulation(ix, plan, { seed: opts.seed, warmup, dt: opts.dt });
  sim.run(warmup + (opts.duration ?? 900));
  return sim.metrics();
}
