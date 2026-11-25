import { DEV } from 'solid-js';
import { listenToDevHooks } from '../dev-hooks.js';
import { quietly } from '../quiet.js';

// Flag bits used by @solidjs/signals. They are internal to the runtime, so the
// values are copied here and every read is defensive.
const REACTIVE_CHECK = 1 << 0;
const REACTIVE_DIRTY = 1 << 1;
const REACTIVE_DISPOSED = 1 << 6;
const REACTIVE_LAZY = 1 << 9;

const STATUS_PENDING = 1 << 0;
const STATUS_ERROR = 1 << 1;
const STATUS_UNINITIALIZED = 1 << 2;

const EFFECT_RENDER = 1;
const EFFECT_USER = 2;
const EFFECT_TRACKED = 3;

/**
 * Set on `_config` of nodes the runtime creates for its own wiring, such as the
 * memo the hot reload wrapper puts between a component and its body. They are
 * nobody's node, so the graph hides them and owner paths skip them.
 */
const CONFIG_PLUMBING = 1 << 25;

/** How many nodes a single snapshot may contain. Anything past this is dropped. */
const NODE_LIMIT = 600;

/** Above this many tracked nodes the per flush counter pass is skipped. */
const STATS_LIMIT = 2000;

/** Raw reactive node. Only the internal fields the graph needs are read. */
type RawNode = Record<string, any>;

export type ReactiveNodeKind =
  | 'signal'
  | 'memo'
  | 'render-effect'
  | 'effect'
  | 'tracked-effect'
  | 'store';

export type ReactiveNodeState = 'clean' | 'check' | 'dirty' | 'disposed';

export interface ReactiveNode {
  id: string;
  kind: ReactiveNodeKind;
  name: string;
  /** Current value, read straight off the node so nothing is tracked. */
  value: unknown;
  state: ReactiveNodeState;
  pending: boolean;
  errored: boolean;
  uninitialized: boolean;
  lazy: boolean;
  error: unknown;
  /** Names of the owners above this node, outermost first. */
  ownerPath: string[];
  /** The runtime node, so another panel can find the same node. */
  raw: object;
  /** The runtime owner the node was created under. */
  owner: object | undefined;
  sources: string[];
  observers: string[];
  /** Times the node's clock advanced while the panel was open. */
  updates: number;
  /** Timestamp of the last observed change. */
  updatedAt: number;
}

export interface ReactiveEdge {
  from: string;
  to: string;
}

export interface ReactiveGraph {
  nodes: ReactiveNode[];
  edges: ReactiveEdge[];
  /** Cheap identity of the snapshot. Equal fingerprints mean nothing changed. */
  fingerprint: string;
  /** Nodes left out because the snapshot hit the node limit. */
  dropped: number;
}

export const EMPTY_GRAPH: ReactiveGraph = {
  nodes: [],
  edges: [],
  fingerprint: 'empty',
  dropped: 0,
};

interface NodeStats {
  time: number;
  updates: number;
  updatedAt: number;
}

let nextId = 1;
const ids = new WeakMap<object, string>();
const stats = new WeakMap<object, NodeStats>();
const signalOwners = new WeakMap<object, RawNode>();
const excluded = new WeakSet<object>();
const included = new WeakSet<object>();

/** Live nodes the runtime told us about. Weak so the app can still collect them. */
const tracked = new Set<WeakRef<RawNode>>();
const trackedRefs = new WeakMap<object, WeakRef<RawNode>>();
const collected =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<WeakRef<RawNode>>((ref) => tracked.delete(ref))
    : undefined;

const listeners = new Set<() => void>();
let stopListening: (() => void) | undefined;
let watchers = 0;
let frame: number | undefined;
/** An owner inside the toolbar. The graph walk climbs from here to the app root. */
let seedOwner: RawNode | undefined;

/** True when the app runs a development build of solid-js. */
export function isReactivityAvailable(): boolean {
  return !!DEV && typeof DEV.getSources === 'function';
}

function idOf(node: RawNode): string {
  let id = ids.get(node);
  if (!id) {
    id = `n${nextId++}`;
    ids.set(node, id);
  }
  return id;
}

/** The graph's id for a runtime node, so another panel can point the graph at it. */
export function reactiveNodeId(node: object): string {
  return idOf(node as RawNode);
}

function track(node: RawNode | null | undefined): void {
  if (!node || typeof node !== 'object' || trackedRefs.has(node)) return;
  const ref = new WeakRef(node);
  trackedRefs.set(node, ref);
  tracked.add(ref);
  collected?.register(node, ref);
}

function notify(): void {
  if (frame !== undefined || listeners.size === 0) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    for (const listener of listeners) listener();
  });
}

/**
 * Starts watching the reactive runtime. The hooks are shared with the other
 * panels through one hub, so panels can start and stop in any order.
 */
export function startReactivityTracking(): () => void {
  if (!isReactivityAvailable()) return () => {};
  watchers++;
  stopListening ??= listenToDevHooks({
    onOwner(owner) {
      track(owner as RawNode);
      notify();
    },
    onGraph(value, owner) {
      if (value && typeof value === 'object') {
        if (owner) signalOwners.set(value, owner as RawNode);
        track(value as RawNode);
      }
      notify();
    },
    onUpdate() {
      recordUpdates();
      notify();
    },
  });
  return release;
}

/**
 * Refreshes the change counters of every tracked node. Runs on each flush so a
 * node that changes twice between two renders is counted twice. Large graphs
 * skip it, because the counter is a convenience and the walk is not free.
 */
function recordUpdates(): void {
  if (tracked.size > STATS_LIMIT) return;
  quietly(() => {
    for (const ref of tracked) {
      const node = ref.deref();
      if (node) statsOf(node);
    }
  });
}

/** Drops one watcher. Stops listening once nothing watches any more. */
function release(): void {
  watchers = Math.max(0, watchers - 1);
  if (watchers > 0 || !stopListening) return;
  stopListening();
  stopListening = undefined;
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
}

/** Calls `listener` after the graph changed, at most once per frame. */
export function subscribeReactivityGraph(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Marks an owner as belonging to the toolbar itself. Nodes under it never show
 * up in the graph, so the panel does not watch its own reactivity.
 */
export function excludeReactiveOwner(owner: unknown): void {
  if (!owner || typeof owner !== 'object') return;
  excluded.add(owner);
  seedOwner ??= owner as RawNode;
}

/**
 * Marks an owner as app code again. The toolbar wraps the app, so the scope
 * holding `props.children` carries this marker and stays in the graph.
 */
export function includeReactiveOwner(owner: unknown): void {
  if (owner && typeof owner === 'object') included.add(owner);
}

function isExcluded(node: RawNode): boolean {
  let owner: RawNode | null | undefined =
    '_parent' in node ? node : (signalOwners.get(node) ?? null);
  // The nearest marker wins, so an included scope inside the toolbar's own
  // subtree still reports as app code.
  for (; owner; owner = owner._parent) {
    if (included.has(owner)) return false;
    if (excluded.has(owner)) return true;
  }
  return false;
}

function isComputed(node: RawNode): boolean {
  return '_deps' in node && typeof node._fn === 'function';
}

/** Owners that only scope other nodes, such as roots and components. */
function isPlainOwner(node: RawNode): boolean {
  return '_parent' in node && !isComputed(node);
}

/** Nodes the runtime created for its own wiring. */
function isPlumbing(node: RawNode): boolean {
  return typeof node._config === 'number' && (node._config & CONFIG_PLUMBING) !== 0;
}

/**
 * A store keeps one signal per property it hands out. Those carry a back
 * reference to the store object they belong to; plain signals do not.
 */
function isStoreNode(node: RawNode): boolean {
  return '_host' in node;
}

function kindOf(node: RawNode): ReactiveNodeKind {
  if (!isComputed(node)) return isStoreNode(node) ? 'store' : 'signal';
  switch (node._type) {
    case EFFECT_RENDER:
      return 'render-effect';
    case EFFECT_USER:
      return 'effect';
    case EFFECT_TRACKED:
      return 'tracked-effect';
    default:
      return 'memo';
  }
}

const KIND_LABELS: Record<ReactiveNodeKind, string> = {
  signal: 'signal',
  memo: 'memo',
  effect: 'effect',
  'render-effect': 'render effect',
  'tracked-effect': 'tracked effect',
  store: 'store',
};

function nameOf(node: RawNode, kind: ReactiveNodeKind): string {
  const name = node._name;
  if (typeof name === 'string' && name.length > 0) return name;
  return KIND_LABELS[kind];
}

// The runtime names an unnamed memo `computed`, which says as little as a kind label.
const DEFAULT_NAMES = new Set([...Object.values(KIND_LABELS), 'computed']);

/** The hot reload transform wraps components, and its wrapper carries this tag. */
const REFRESH_PREFIX = '[solid-refresh]';

/** The owner a node was created under. Signals keep it in the registry. */
function ownerOf(node: RawNode): RawNode | undefined {
  return ('_parent' in node ? node._parent : signalOwners.get(node)) ?? undefined;
}

/**
 * The label an owner shows in a path. Components show their name. Owners that
 * only carry a default kind name, and the memo the hot reload wrapper creates,
 * say nothing about where the node lives, so they show nothing.
 */
function ownerLabel(owner: RawNode): string | undefined {
  if (isPlumbing(owner)) return undefined;
  const component = owner._component?.name;
  if (typeof component === 'string') {
    const name = component.startsWith(REFRESH_PREFIX)
      ? component.slice(REFRESH_PREFIX.length)
      : component;
    return `<${name || 'Anonymous'}>`;
  }
  const name = owner._name;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (name.startsWith(REFRESH_PREFIX) || DEFAULT_NAMES.has(name)) return undefined;
  return name;
}

function ownerPathOf(node: RawNode): string[] {
  const path: string[] = [];
  for (let owner = ownerOf(node); owner; owner = owner._parent ?? undefined) {
    // The scope that owns the app sits inside the toolbar. Everything above it
    // is the toolbar's own wrapping, so the path stops there.
    if (included.has(owner)) break;
    const label = ownerLabel(owner);
    if (label) path.push(label);
  }
  return path.reverse();
}

function stateOf(node: RawNode): ReactiveNodeState {
  const flags = typeof node._flags === 'number' ? node._flags : 0;
  if (flags & REACTIVE_DISPOSED) return 'disposed';
  if (flags & REACTIVE_DIRTY) return 'dirty';
  if (flags & REACTIVE_CHECK) return 'check';
  return 'clean';
}

function statsOf(node: RawNode): NodeStats {
  const time = typeof node._time === 'number' ? node._time : 0;
  let entry = stats.get(node);
  if (!entry) {
    entry = { time, updates: 0, updatedAt: 0 };
    stats.set(node, entry);
    return entry;
  }
  if (time !== entry.time) {
    entry.time = time;
    entry.updates += 1;
    entry.updatedAt = Date.now();
  }
  return entry;
}

function sourcesOf(node: RawNode): RawNode[] {
  if (!isComputed(node)) return [];
  try {
    return DEV!.getSources(node as never) as RawNode[];
  } catch {
    return [];
  }
}

function observersOf(node: RawNode): RawNode[] {
  try {
    return DEV!.getObservers(node as never) as RawNode[];
  } catch {
    return [];
  }
}

/** Topmost owner above `node`. */
function rootOf(node: RawNode): RawNode {
  let owner = node;
  while (owner._parent) owner = owner._parent;
  return owner;
}

/**
 * Collects every node under `owner`. This finds nodes created before the
 * toolbar started watching. Toolbar nodes are dropped later, by `isExcluded`,
 * because an app scope can sit inside the toolbar's own subtree.
 */
function collectOwnerTree(owner: RawNode, out: RawNode[]): void {
  out.push(owner);
  try {
    for (const signal of DEV!.getSignals(owner as never)) {
      if (!signal || typeof signal !== 'object') continue;
      // The walk knows the owner, so record it. Signals created before the
      // hooks went on have no entry yet, and without one they cannot be
      // attributed to the app or to the toolbar.
      signalOwners.set(signal, owner);
      out.push(signal as RawNode);
    }
    for (const child of DEV!.getChildren(owner as never)) {
      collectOwnerTree(child as RawNode, out);
    }
  } catch {
    // A node disposed mid walk. Whatever was collected is still usable.
  }
}

export interface SnapshotOptions {
  /** Keep nodes the runtime already disposed. Off by default. */
  includeDisposed?: boolean;
}

/**
 * Reads the current reactive graph.
 *
 * Registered nodes are the seed. The walk then follows sources and observers so
 * nodes created before the toolbar started watching still show up when they are
 * connected to something known.
 */
export function snapshotReactivityGraph(options?: SnapshotOptions): ReactiveGraph {
  if (!isReactivityAvailable()) return EMPTY_GRAPH;
  return quietly(() => readGraph(options));
}

function readGraph(options?: SnapshotOptions): ReactiveGraph {
  const includeDisposed = options?.includeDisposed ?? false;

  const queue: RawNode[] = [];
  const seen = new Set<RawNode>();
  const kept = new Map<RawNode, ReactiveNode>();
  let dropped = 0;

  for (const ref of tracked) {
    const node = ref.deref();
    if (!node) {
      tracked.delete(ref);
      continue;
    }
    queue.push(node);
  }

  const roots = new Set<RawNode>();
  if (seedOwner) roots.add(rootOf(seedOwner));
  for (const node of queue) {
    if ('_parent' in node) roots.add(rootOf(node));
  }
  for (const root of roots) collectOwnerTree(root, queue);

  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    if (seen.has(node)) continue;
    seen.add(node);

    // Roots and components are scopes, not graph nodes. They still contribute
    // their name to the owner path of everything below them.
    if (isPlainOwner(node)) continue;
    if (isPlumbing(node)) continue;
    if (isExcluded(node)) continue;

    const state = stateOf(node);
    if (state === 'disposed' && !includeDisposed) continue;

    if (kept.size >= NODE_LIMIT) {
      dropped++;
      continue;
    }

    const kind = kindOf(node);
    const entry = statsOf(node);
    const statusFlags = typeof node._statusFlags === 'number' ? node._statusFlags : 0;
    const flags = typeof node._flags === 'number' ? node._flags : 0;

    kept.set(node, {
      id: idOf(node),
      kind,
      name: nameOf(node, kind),
      value: node._value,
      state,
      pending: (statusFlags & STATUS_PENDING) !== 0,
      errored: (statusFlags & STATUS_ERROR) !== 0,
      uninitialized: (statusFlags & STATUS_UNINITIALIZED) !== 0,
      lazy: (flags & REACTIVE_LAZY) !== 0,
      // The runtime keeps rarely used state on a node extension.
      error: node._x?._error,
      ownerPath: ownerPathOf(node),
      raw: node,
      owner: ownerOf(node),
      sources: [],
      observers: [],
      updates: entry.updates,
      updatedAt: entry.updatedAt,
    });

    for (const source of sourcesOf(node)) queue.push(source);
    for (const observer of observersOf(node)) queue.push(observer);
  }

  const edges: ReactiveEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const [node, descriptor] of kept) {
    for (const source of sourcesOf(node)) {
      const from = kept.get(source);
      if (!from) continue;
      descriptor.sources.push(from.id);
      const key = `${from.id}>${descriptor.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: from.id, to: descriptor.id });
    }
    for (const observer of observersOf(node)) {
      const to = kept.get(observer);
      if (!to) continue;
      descriptor.observers.push(to.id);
      const key = `${descriptor.id}>${to.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: descriptor.id, to: to.id });
    }
  }

  const nodes = [...kept.values()];
  let fingerprint = `${nodes.length}:${edges.length}:${dropped}`;
  for (const node of nodes) {
    fingerprint += `|${node.id}${node.state}${node.updates}${node.pending ? 'p' : ''}${
      node.errored ? 'e' : ''
    }${node.sources.length}${node.observers.length}`;
  }

  return { nodes, edges, fingerprint, dropped };
}
