# XRoad — Traffic-light timing optimizer (genetic algorithm)

A small browser app, for learning and demos, that lets you define a single signalized
crossroad and evolves its traffic-light timing plan with a genetic algorithm, then
visualizes the result against a classic baseline.

## Scope decisions

| Topic | Decision |
|---|---|
| Network | One intersection only |
| What is optimized | Signal timing only (phase composition, order, green durations) |
| Control type | Traffic lights only (no roundabouts, no stop signs) |
| Pedestrians | Not modeled |
| Clearance | Yellow (3 s) + all-red (2 s) after each phase, minimum green 5 s |
| Geometry | Right angles only: N/E/S/W arms, each enabled or not (≥ 3 → T or 4-way) |
| Lanes | 1–4 inbound lanes per arm (configurable), outbound lanes configurable |
| Traffic side | Right-hand traffic |
| Left turns | Protected only (no gap acceptance) |
| Purpose | Learning / demo — clarity over realism |

## 1. Intersection model

- Arms N/E/S/W, each `enabled`, with `inLanes` (1–4) and `outLanes` (1–4).
- Per inbound lane: allowed turns ⊂ {L, S, R}. Sensible defaults are generated
  (leftmost L+S, middle S, rightmost S+R; T-junction stem splits L/R), editable per lane.
  Lanes must not cross: turns must be ordered L → S → R from left lane to right lane.
- Demand: vehicles/hour per movement (arm × turn), constant over the run.
- A **movement** is `(fromArm, turn)`, e.g. `NL` = from North, turning left (→ East).
- Each (lane, turn) gets a geometric path (quadratic Bézier) from the stop line to an
  exit lane on the target arm.
- **Conflicts** (movement level, computed automatically):
  - same origin arm → compatible;
  - same target arm and overlapping exit lanes → conflict (merge);
  - opposite arms → conflict only for left vs. straight (opposing lefts are compatible);
  - perpendicular arms → conflict when neither movement is a right turn.
- **Phase candidates**: all *maximal* sets of mutually compatible movements
  (Bron–Kerbosch on the compatibility graph).
- Presets: balanced 4-way, main road × side road, T-junction. Save/load as JSON.

## 2. Signal plan (the genome)

- Ordered list of 2–6 phases; each phase references one maximal compatible set.
- Each phase has a green time in [5, 60] s.
- Fixed inter-green after every phase: 3 s yellow + 2 s all-red.
- Constraint: every movement with demand is green in at least one phase per cycle
  (enforced by a repair operator).

## 3. Simulation

- Microscopic, time step 0.5 s, headless (no rendering) for GA evaluation.
- Car following: Intelligent Driver Model (IDM) along lanes; inside the box vehicles
  follow their Bézier path (signal plan + all-red guarantee no conflicting occupancy).
- Arrivals: Poisson per movement; a vehicle picks the shortest queue among lanes
  allowing its movement.
- Signals: red/yellow acts as a stopped virtual vehicle at the stop line, unless the
  vehicle cannot stop comfortably (dilemma zone → proceeds on yellow).
- Seeded RNG; 2-minute warm-up + 15-minute measured horizon; every individual is
  evaluated on the same 2–3 seeds (common random numbers).
- Metrics: average delay, throughput, stops, max queue, vehicles left unserved.

## 4. Fitness & GA

- Fitness (minimize) = weighted sum of avg delay, max queue, stops
  + heavy penalty for unserved vehicles. Weights adjustable in UI.
- Population ~50, tournament selection (k = 3), elitism 2.
- Crossover: phase-level one-point on the phase list, blend of green times.
- Mutation: Gaussian green-time tweak, swap phases, replace a phase's set,
  add/remove a phase. Then repair.
- Parallel evaluation in a Web Worker pool.
- Baseline: Webster fixed-time plan (optimal cycle `C0 = (1.5L + 5) / (1 − Y)`,
  greens split by critical flow ratios).

## 5. UI

1. **Editor** — top-down canvas + side panel (arms, lanes, lane turns, demand), presets,
   JSON save/load. Inspect movements, conflicts and candidate phases.
2. **Optimizer** — GA parameters, fitness weights, Start/Pause/Step, convergence chart
   (best/avg per generation), best plan as a phase timeline (green/yellow/all-red).
3. **Simulation** — animated replay, Webster vs. GA best side by side, speed control,
   vehicles colored by waiting time, live metrics.

## 6. Stack & structure

Vite + TypeScript, no UI framework, Canvas 2D, uPlot (chart), Vitest (tests).

```
src/model/   types, geometry, lanes, intersection compiler, conflicts, phases, presets
src/sim/     rng, idm, engine, metrics
src/ga/      genome, operators, repair, ga loop, webster
src/worker/  evaluation worker + pool
src/ui/      editor, optimizer panel, chart, plan timeline, sim view
```

## 7. Milestones

1. ✅ **Model** — types, geometry, lane defaults, conflicts, phase sets, static render, tests.
2. ✅ **Simulation** — engine + animated replay of a hand-written plan.
3. ✅ **Metrics & baseline** — metrics collection, Webster plan.
4. ✅ **GA** — GA + convergence chart, evaluated in a Web Worker pool (pulled forward from 5).
5. **Comparison** — plan timeline, side-by-side replay (Webster vs GA).
6. **Editor & polish** — interactive editor, presets, JSON save/load.
