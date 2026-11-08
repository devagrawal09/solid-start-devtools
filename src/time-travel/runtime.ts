/**
 * Time travel over the tracked part of the reactive graph.
 *
 * Recording is the runtime's: every drain delivers a `flush` record whose
 * `changes` list what the drain changed on screen (a commit, an action's
 * landing, an optimistic value appearing or lifting), each with the origin
 * that staged it. A drain that changed a tracked primitive is one step.
 * Nothing here runs per write.
 *
 * Rewinding is an overlay. `goto` writes nothing to the tracked state: it
 * moves a cursor, and every tracked getter (and a tracked store's proxy) is a
 * view that shows the recorded value while traveling and the live one
 * otherwise. The live primitives keep running underneath, so writes, async
 * landings and new steps keep arriving during travel. `resume` moves the
 * cursor back. `branch` makes the viewed step the present.
 *
 * - The cursor is written twice, a plain signal plus a `createOptimistic`
 *   over it: an action holding a write to a viewed source holds a plain
 *   cursor write too, and the optimistic layer shows the move at once.
 * - Tracked memos compute in the live lane: a tracked getter read directly by
 *   a tracked memo's own computation returns the live value, so a memo never
 *   recomputes (or refetches) from the past while you look at it.
 *
 * Needs a development build of solid-js whose `flush` record carries
 * `changes`. Without one, `createTracked` still returns working primitives
 * and the timeline reports that it is unsupported.
 */
import {
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  deep,
  DEV,
  getObserver,
  getOwner,
  OBSERVE,
  onCleanup,
  reconcile,
  runWithOwner,
  snapshot,
  untrack,
} from 'solid-js';
import { attribution } from 'solid-js/attribution';

export interface Step {
  id: number;
  /** When the drain ended, on the `performance.now()` clock. */
  at: number;
  /** The tracked values the step changed, by name. A store's value is the whole store. */
  changes: Record<string, unknown>;
  /** The actions whose writes the step shows: an action's optimistic writes, its landing. */
  actions: string[];
  /** The interaction or navigation the step traces to, when one is known. */
  cause?: string;
}

export interface Timeline {
  /** The recorded steps, oldest first. Reactive. */
  steps(): readonly Step[];
  /** The tracked names with the value each had before the first step. */
  initial(): Record<string, unknown>;
  /** Shows the app as it was right after step `id` (0: before the first step). */
  goto(id: number): void;
  /** Back to the present. */
  resume(): void;
  /** Makes the viewed step the present and drops the steps after it. */
  branch(): void;
  /** Drops every step. The present becomes the initial state. */
  clear(): void;
  /** True while a past step is shown. Reactive. */
  traveling(): boolean;
  /** The step shown, or -1 for the present. Reactive. */
  cursor(): number;
  /**
   * Whether the runtime reports what each drain changed. `undefined` until the
   * first drain. Reactive.
   */
  supported(): boolean | undefined;
}

const LIVE = -1;
const NONE: unknown = Symbol('none');
/** Names of the timeline's own nodes, filtered out of the record. */
const INTERNAL = '\u0000start-devtools-tt';
/** Where the toolbar finds the timeline, whichever bundle created it. */
const REGISTRY = Symbol.for('@solidjs/start-devtools/time-travel');

interface Registry {
  timeline: Timeline | undefined;
  listeners: Set<() => void>;
}

/** The toolbar's view of the registry: the timeline once an app tracks something. */
export function timelineRegistry(): Registry {
  const g = globalThis as { [REGISTRY]?: Registry };
  return (g[REGISTRY] ??= { timeline: undefined, listeners: new Set() });
}

/** One tracked primitive's history: the step ids it changed at, with values. */
class History {
  ids: number[] = [];
  values: unknown[] = [];
  constructor(public baseline: unknown) {}
  at(id: number): unknown {
    let lo = 0;
    let hi = this.ids.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ids[mid] <= id) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? this.baseline : this.values[found];
  }
  last(): unknown {
    return this.ids.length ? this.values[this.values.length - 1] : this.baseline;
  }
  record(id: number, value: unknown): void {
    this.ids.push(id);
    this.values.push(value);
  }
  cut(after: number): void {
    while (this.ids.length && this.ids[this.ids.length - 1] > after) {
      this.ids.pop();
      this.values.pop();
    }
  }
}

interface Tracked {
  name: string;
  history: History;
  /** Makes `value` the present (branch). */
  restore(value: unknown): void;
  /** A store: its value at a drain end. */
  capture?(): unknown;
}

interface State {
  timeline: Timeline;
  cursor: () => number;
  byNode: WeakMap<object, Tracked>;
  byStore: WeakMap<object, Tracked>;
  tracked: Set<Tracked>;
  /** Branch's own writes coming back: skipped once when equal. */
  echoes: Map<Tracked, unknown>;
}

let state: State | undefined;

/** Structural equality for plain data (the branch echo). */
function same(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => same(a[key], b[key]));
}

/** Copies plain objects and arrays; anything else by reference. */
function clonePlain(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clonePlain);
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = clonePlain(value[key]);
  return out;
}

/** A store property node's store: its host target's root proxy. */
function storeOf(node: any): object | undefined {
  let target = node?._host;
  if (!target) return undefined;
  while (target.u) target = target.u;
  return target.px;
}

/**
 * Builds the timeline's own nodes outside the caller's owner, so they take no
 * hydration id (the server renders `createTracked` as the bare primitive and
 * creates none of them), and disposes them with the caller.
 */
function detached<T>(fn: () => T): T {
  const owner = getOwner();
  return runWithOwner(null, () =>
    createRoot((dispose) => {
      const value = fn();
      if (owner) runWithOwner(owner, () => onCleanup(dispose));
      return value;
    }),
  ) as T;
}

/** The node behind a getter: read it in a throwaway memo and ask for its source. */
function nodeOf(read: () => unknown): object | undefined {
  if (!DEV) return undefined;
  let node: object | undefined;
  runWithOwner(null, () =>
    createRoot((dispose) => {
      let observer: any;
      // Computed as it is created: no read needed (one in a component body is a
      // STRICT_READ_UNTRACKED warning).
      createMemo(
        () => {
          observer = getObserver();
          try {
            read();
          } catch {
            // Pending: the read still linked the node.
          }
        },
        { name: `${INTERNAL}.probe` } as any,
      );
      if (observer) node = DEV!.getSources(observer)[0];
      dispose();
    }),
  );
  return node;
}

function label(origin: any): string | undefined {
  if (!origin) return undefined;
  if (origin.kind === 'interaction') {
    return `${origin.name ?? 'interaction'}${origin.target ? ` on ${origin.target}` : ''}`;
  }
  if (origin.kind === 'navigation') return `navigation to ${origin.to ?? origin.name}`;
  return origin.interaction ? label(origin.interaction) : undefined;
}

function start(): State {
  // The timeline outlives whichever component tracked something first.
  return runWithOwner(null, () => createRoot(() => startDetached())) as State;
}

function startDetached(): State {
  // The engine's findings belong to the other panels; this only needs its records.
  attribution.enable({
    log: false,
    checks: false,
    waterfalls: false,
    holds: false,
    longHolds: false,
    graphGrowth: false,
    abandonedFlights: false,
    fallbackFlashes: false,
    optimisticReverts: false,
    stackedHolds: false,
  });

  const [base, setBase] = createSignal(LIVE, { name: `${INTERNAL}.base` } as any);
  const [cursor, setCursor] = createOptimistic<number>(() => base(), {
    name: `${INTERNAL}.cursor`,
  } as any);
  const move = (id: number) => {
    setBase(id);
    setCursor(id);
  };
  const traveling = createMemo(() => cursor() !== LIVE, { name: `${INTERNAL}.traveling` } as any);
  const [steps, setSteps] = createSignal<readonly Step[]>([], { name: `${INTERNAL}.steps` } as any);
  const [supported, setSupported] = createSignal<boolean | undefined>(undefined, {
    name: `${INTERNAL}.supported`,
  } as any);
  const log: Step[] = [];
  let nextId = 1;

  const s: State = {
    timeline: undefined as any,
    cursor,
    byNode: new WeakMap(),
    byStore: new WeakMap(),
    tracked: new Set(),
    echoes: new Map(),
  };

  // Records arrive inside the runtime, which must not be written to: publish after.
  let publishing = false;
  const publish = () => {
    if (publishing) return;
    publishing = true;
    queueMicrotask(() => {
      publishing = false;
      setSteps(log.slice());
    });
  };

  let detected = false;
  OBSERVE!.records.subscribe(
    'flush',
    (event, live) => {
      const changes = (event as { changes?: { nodeName: string; origin?: unknown }[] }).changes;
      if (!detected) {
        detected = true;
        const ok = Array.isArray(changes);
        queueMicrotask(() => setSupported(ok));
      }
      if (!changes) return;
      const liveChanges = (live as { changes: { node: object; prev?: unknown; value?: unknown }[] })
        .changes;
      const step: Step = { id: nextId, at: performance.now(), changes: {}, actions: [] };
      const stores = new Set<Tracked>();
      let any = false;
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (change.nodeName.startsWith(INTERNAL)) continue;
        const { node, prev, value } = liveChanges[i];
        const store = storeOf(node);
        const tracked = store !== undefined ? s.byStore.get(store) : s.byNode.get(node);
        if (tracked === undefined || !s.tracked.has(tracked)) continue;
        const origin = change.origin as { kind?: string; name?: string } | undefined;
        if (origin?.kind === 'action' && origin.name && !step.actions.includes(origin.name)) {
          step.actions.push(origin.name);
        }
        step.cause ??= label(origin);
        if (store !== undefined) {
          stores.add(tracked);
          continue;
        }
        // A first value never seen (an async memo's first answer) is the baseline.
        if (tracked.history.baseline === NONE) tracked.history.baseline = prev;
        if (s.echoes.has(tracked) && same(s.echoes.get(tracked), value)) {
          s.echoes.delete(tracked);
          continue;
        }
        step.changes[tracked.name] = value;
        any = true;
      }
      for (const tracked of stores) {
        const value = tracked.capture!();
        if (s.echoes.has(tracked) && same(s.echoes.get(tracked), value)) {
          s.echoes.delete(tracked);
          continue;
        }
        if (Object.is(value, tracked.history.last())) continue;
        step.changes[tracked.name] = value;
        any = true;
      }
      if (!any) return;
      if (step.cause === undefined) delete step.cause;
      for (const tracked of s.tracked) {
        if (tracked.name in step.changes)
          tracked.history.record(step.id, step.changes[tracked.name]);
      }
      nextId++;
      log.push(step);
      publish();
    },
    { bodies: true },
  );

  s.timeline = {
    steps,
    traveling,
    cursor,
    supported,
    initial() {
      const out: Record<string, unknown> = {};
      for (const tracked of s.tracked) {
        if (tracked.history.baseline !== NONE) out[tracked.name] = tracked.history.baseline;
      }
      return out;
    },
    goto(id) {
      move(Math.max(0, Math.min(id, nextId - 1)));
    },
    resume() {
      move(LIVE);
    },
    branch() {
      const at = untrack(cursor);
      if (at === LIVE) return;
      const cut = log.findIndex((step) => step.id > at);
      if (cut >= 0) log.length = cut;
      nextId = at + 1;
      for (const tracked of s.tracked) {
        const value = tracked.history.at(at);
        const current = tracked.history.last();
        tracked.history.cut(at);
        if (value === NONE || same(value, current)) continue;
        s.echoes.set(tracked, value);
        tracked.restore(value);
      }
      setSteps(log.slice());
      // Only the plain cursor: a restore an action holds lands with it, and
      // until then the optimistic layer keeps showing the branch point.
      setBase(LIVE);
    },
    clear() {
      if (untrack(cursor) !== LIVE) return;
      for (const tracked of s.tracked) {
        tracked.history.baseline = tracked.history.last();
        tracked.history.ids = [];
        tracked.history.values = [];
      }
      log.length = 0;
      nextId = 1;
      setSteps([]);
    },
  };

  const registry = timelineRegistry();
  registry.timeline = s.timeline;
  for (const listener of registry.listeners) listener();
  return s;
}

/** The timeline, started by the first tracked primitive. */
export function getTimeline(): Timeline | undefined {
  return state?.timeline;
}

function current(): State | undefined {
  if (!OBSERVE || !DEV) return undefined;
  return (state ??= start());
}

// --- The live lane -------------------------------------------------------------

/** Computations of tracked memos: a tracked getter read directly by one reads live. */
const lane = new WeakSet<object>();
let laneDepth = 0;
const inLane = () => {
  if (laneDepth === 0) return false;
  const observer = getObserver();
  return observer != null && lane.has(observer);
};

let unnamed = 0;
function nameOf(options: any, kind: string): string {
  return options?.name ?? `${kind} ${++unnamed}`;
}

/** A getter that shows the recorded value while traveling. */
function viewOf<T>(s: State, live: () => T, history: History): () => T {
  const view = detached(() =>
    createMemo<T>(
      () => {
        const at = s.cursor();
        if (at === LIVE) return live();
        const value = history.at(at);
        return (value === NONE ? live() : value) as T;
      },
      { name: `${INTERNAL}.view` } as any,
    ),
  );
  return () => (inLane() ? live() : view());
}

function trackSignal(s: State, create: (...args: any[]) => any, args: any[], kind: string): any {
  const [live, set] = create(...args);
  let initial: unknown = NONE;
  try {
    initial = untrack(live);
  } catch {}
  const tracked: Tracked = {
    name: nameOf(args[1], kind),
    history: new History(initial),
    restore: (value) => void set(() => value),
  };
  const node = nodeOf(live);
  if (node) s.byNode.set(node, tracked);
  s.tracked.add(tracked);
  return [viewOf(s, live, tracked.history), set];
}

function trackMemo(s: State, args: any[]): any {
  const [fn, options] = args;
  const live = createMemo((prev: unknown) => {
    lane.add(getObserver()!);
    laneDepth++;
    try {
      return fn(prev);
    } finally {
      laneDepth--;
    }
  }, options);
  let initial: unknown = NONE;
  try {
    initial = untrack(live);
  } catch {}
  const tracked: Tracked = {
    name: nameOf(options, 'memo'),
    history: new History(initial),
    // A memo re-derives from its restored sources.
    restore: () => {},
  };
  const node = nodeOf(live);
  if (node) s.byNode.set(node, tracked);
  s.tracked.add(tracked);
  return viewOf(s, live as () => unknown, tracked.history);
}

function trackStore(
  s: State,
  proxy: any,
  setState: ((fn: (draft: any) => void) => void) | undefined,
  options: any,
  kind: string,
): any {
  const tracked: Tracked = {
    name: nameOf(options, kind),
    history: new History(snapshot(proxy)),
    restore: (value) =>
      setState?.((draft: any) => {
        // A clone, so recorded objects never become the live store's backing.
        try {
          reconcile(clonePlain(value), 'id')(draft);
        } catch {
          reconcile(clonePlain(value), null)(draft);
        }
      }),
    capture: () => snapshot(proxy),
  };
  s.byStore.set(proxy, tracked);
  s.tracked.add(tracked);
  // What everything reads: the live store or a recorded snapshot, reconciled
  // into one projection keyed by `id`, so rows keep their proxies and only
  // the values that differ notify. `deep` subscribes to every property of the
  // live store, so its changes reach the record even when only the view is read.
  return detached(() =>
    createProjection(
      () => {
        const at = s.cursor();
        return (at === LIVE ? deep(proxy) : tracked.history.at(at)) as any;
      },
      (Array.isArray(untrack(() => snapshot(proxy))) ? [] : {}) as any,
      { key: 'id', name: `${INTERNAL}.view` } as any,
    ),
  );
}

/** The implementation behind `createTracked`'s overloads (index.ts). */
export function track(create: (...args: any[]) => any, args: any[]): any {
  const s = current();
  if (s === undefined) return create(...args);
  if (create === (createSignal as unknown)) return trackSignal(s, create, args, 'signal');
  if (create === (createOptimistic as unknown)) return trackSignal(s, create, args, 'optimistic');
  if (create === (createMemo as unknown)) return trackMemo(s, args);
  if (create === (createStore as unknown) || create === (createOptimisticStore as unknown)) {
    if (typeof args[0] === 'function') return create(...args);
    const [proxy, setState] = create(...args);
    return [trackStore(s, proxy, setState, args[1], 'store'), setState];
  }
  if (create === (createProjection as unknown)) {
    return trackStore(s, create(...args), undefined, args[2], 'projection');
  }
  throw new Error('createTracked: unsupported primitive');
}
