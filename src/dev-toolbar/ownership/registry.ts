import { DEV } from 'solid-js';
import { listenToDevHooks } from '../dev-hooks.js';
import { quietly } from '../quiet.js';
import { isSolidBuiltin } from './builtins.js';
import { buildOwnershipTree, EMPTY_TREE, type OwnershipTree, type RawNode } from './tree.js';

let nextId = 1;
const ids = new WeakMap<object, string>();
const excluded = new WeakSet<object>();
const included = new WeakSet<object>();

/** Owners the runtime told us about, weak so the app can still collect them. */
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
/** An owner inside the toolbar. The walk climbs from here to the app root. */
let seedOwner: RawNode | undefined;

/** True when the app runs a development build of solid-js. */
export function isOwnershipAvailable(): boolean {
  return !!DEV && typeof DEV.getChildren === 'function';
}

function identify(node: object): string {
  let id = ids.get(node);
  if (!id) {
    id = `o${nextId++}`;
    ids.set(node, id);
  }
  return id;
}

function track(owner: RawNode | null | undefined): void {
  if (!owner || typeof owner !== 'object' || trackedRefs.has(owner)) return;
  const ref = new WeakRef(owner);
  trackedRefs.set(owner, ref);
  tracked.add(ref);
  collected?.register(owner, ref);
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
export function startOwnershipTracking(): () => void {
  if (!isOwnershipAvailable()) return () => {};
  watchers++;
  stopListening ??= listenToDevHooks({
    onOwner(owner) {
      track(owner as RawNode);
      notify();
    },
    onGraph(_value, owner) {
      if (owner) track(owner as RawNode);
      notify();
    },
    onUpdate() {
      notify();
    },
  });
  return release;
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

/** Calls `listener` after the tree changed, at most once per frame. */
export function subscribeOwnershipTree(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Marks an owner as belonging to the toolbar itself. Its subtree never shows up
 * in the tree, so the panel does not list its own components.
 */
export function excludeOwner(owner: unknown): void {
  if (!owner || typeof owner !== 'object') return;
  excluded.add(owner);
  seedOwner ??= owner as RawNode;
}

/**
 * Marks an owner as app code again. The toolbar wraps the app, so the scope
 * holding `props.children` carries this marker and stays in the tree.
 */
export function includeOwner(owner: unknown): void {
  if (owner && typeof owner === 'object') included.add(owner);
}

function isExcluded(owner: RawNode): boolean {
  return excluded.has(owner);
}

function isIncluded(owner: RawNode): boolean {
  return included.has(owner);
}

function childrenOf(owner: RawNode): RawNode[] {
  try {
    // The runtime keeps the newest child first, so reversing puts the tree in
    // creation order, which is the order the app reads in.
    return (DEV!.getChildren(owner as never) as RawNode[]).reverse();
  } catch {
    return [];
  }
}

function signalsOf(owner: RawNode): RawNode[] {
  try {
    return DEV!.getSignals(owner as never) as RawNode[];
  } catch {
    return [];
  }
}

/**
 * Ids of an owner and every owner above it, nearest first. Another panel uses
 * this to find the closest row the tree shows for a runtime node.
 */
export function ownerChainIds(owner: object): string[] {
  const chain: string[] = [];
  for (let current = owner as RawNode | null | undefined; current; current = current._parent) {
    chain.push(identify(current));
  }
  return chain;
}

function rootOf(owner: RawNode): RawNode {
  let current = owner;
  while (current._parent) current = current._parent;
  return current;
}

export interface SnapshotOptions {
  componentsOnly?: boolean;
  /** Fold the components Solid ships into their parents. */
  hideBuiltins?: boolean;
  includeDisposed?: boolean;
}

/**
 * Reads the current owner tree.
 *
 * The walk starts at every known root: the one above the toolbar, plus the root
 * of every owner the hooks reported. That covers owners created before the
 * panel opened and roots the toolbar does not sit under.
 */
export function snapshotOwnershipTree(options?: SnapshotOptions): OwnershipTree {
  if (!isOwnershipAvailable()) return EMPTY_TREE;
  return quietly(() => readTree(options));
}

function readTree(options?: SnapshotOptions): OwnershipTree {
  const roots = new Set<RawNode>();
  if (seedOwner) roots.add(rootOf(seedOwner));
  for (const ref of tracked) {
    const owner = ref.deref();
    if (!owner) {
      tracked.delete(ref);
      continue;
    }
    roots.add(rootOf(owner));
  }

  return buildOwnershipTree([...roots], {
    children: childrenOf,
    signals: signalsOf,
    identify,
    isExcluded,
    isIncluded,
    componentsOnly: options?.componentsOnly ?? true,
    includeDisposed: options?.includeDisposed,
    hideBuiltins: options?.hideBuiltins ?? options?.componentsOnly ?? true,
    isBuiltin: isSolidBuiltin,
  });
}
