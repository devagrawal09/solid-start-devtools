import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_GRAPH,
  excludeReactiveOwner,
  includeReactiveOwner,
  isReactivityAvailable,
  snapshotReactivityGraph,
  startReactivityTracking,
  subscribeReactivityGraph,
} from './registry.js';

// The registry reads `DEV` off solid-js. Every build of solid-js that vitest
// can resolve ships it now, so the module is replaced with a slot the suites
// below fill in: nothing, for the path an app takes in production, and a fake
// dev runtime built from plain objects shaped like the runtime's nodes.
const runtime = vi.hoisted(() => ({ DEV: undefined as any }));

vi.mock('solid-js', () => ({
  get DEV() {
    return runtime.DEV;
  },
  untrack: <T>(read: () => T): T => read(),
}));

describe('registry without the dev runtime', () => {
  it('reports that the graph is unavailable', () => {
    expect(isReactivityAvailable()).toBe(false);
  });

  it('returns an empty graph', () => {
    expect(snapshotReactivityGraph()).toBe(EMPTY_GRAPH);
  });

  it('keeps tracking a no-op', () => {
    const stop = startReactivityTracking();

    expect(() => stop()).not.toThrow();
  });

  it('ignores owners that are not objects', () => {
    expect(() => excludeReactiveOwner(null)).not.toThrow();
    expect(() => includeReactiveOwner(undefined)).not.toThrow();
  });

  it('never calls a listener', () => {
    let calls = 0;
    const unsubscribe = subscribeReactivityGraph(() => calls++);
    snapshotReactivityGraph();
    unsubscribe();

    expect(calls).toBe(0);
  });
});

// Flag bits copied from @solidjs/signals, the same way the registry copies them.
const STATUS_ERROR = 1 << 1;
const CONFIG_PLUMBING = 1 << 25;

type RawNode = Record<string, any>;

interface OwnerOptions {
  name?: string;
  component?: string;
  memo?: boolean;
  config?: number;
  value?: unknown;
  statusFlags?: number;
  error?: unknown;
}

/** Builds an owner shaped like the ones the runtime creates, under `parent`. */
function owner(parent: RawNode | null, options: OwnerOptions = {}): RawNode {
  const node: RawNode = {
    _parent: parent,
    _children: [],
    _signals: [],
    _sources: [],
    _observers: [],
    _config: options.config ?? 0,
  };
  if (options.name) node._name = options.name;
  if (options.component) node._component = { name: options.component, props: {}, fn() {} };
  if (options.memo) {
    node._deps = null;
    node._fn = () => undefined;
    node._value = options.value;
  }
  if (options.statusFlags !== undefined) node._statusFlags = options.statusFlags;
  // Rarely used state, such as the error a node threw, lives on the extension.
  if (options.error !== undefined) node._x = { _error: options.error };
  parent?._children.push(node);
  return node;
}

interface SignalOptions {
  name?: string;
  /** Marks the signal as a store slot node, which carries the store target. */
  host?: object;
}

function signal(parent: RawNode, value: unknown, options: SignalOptions = {}): RawNode {
  const node: RawNode = { _value: value, _observers: [] };
  if (options.name) node._name = options.name;
  if (options.host) {
    node._host = options.host;
    node._key = options.name;
  }
  parent._signals.push(node);
  return node;
}

/** Wires `source` into `target`, in both directions, like the runtime does. */
function link(source: RawNode, target: RawNode): void {
  source._observers.push(target);
  target._sources.push(source);
}

function fakeDev() {
  return {
    hooks: {} as Record<string, ((...args: any[]) => void) | undefined>,
    getChildren: (node: RawNode) => node._children ?? [],
    getSignals: (node: RawNode) => node._signals ?? [],
    getSources: (node: RawNode) => node._sources ?? [],
    getObservers: (node: RawNode) => node._observers ?? [],
  };
}

describe('registry with a dev runtime', () => {
  // One runtime for the suite. The hooks hub binds to `DEV.hooks` once, the
  // same way it does against the real runtime.
  const dev = fakeDev();
  let stop: () => void;

  beforeEach(() => {
    runtime.DEV = dev;
    stop = startReactivityTracking();
  });

  afterEach(() => {
    stop();
    runtime.DEV = undefined;
  });

  /**
   * Tells the registry about `root` the way the runtime does, then snapshots
   * the nodes under it. The registry keeps every root it was told about, so
   * roots of earlier tests still show up and each test reads its own.
   */
  function snapshot(root: RawNode) {
    runtime.DEV.hooks.onOwner(root);
    const label = `<${root._component.name}>`;
    return snapshotReactivityGraph().nodes.filter((node) => node.ownerPath[0] === label);
  }

  function byName(nodes: ReturnType<typeof snapshot>, name: string) {
    return nodes.find((node) => node.name === name);
  }

  it('reports that the graph is available', () => {
    expect(isReactivityAvailable()).toBe(true);
  });

  it('reads the error a node threw off its extension', () => {
    const root = owner(null, { component: 'ErrorApp' });
    const failure = new Error('boom');
    owner(root, { memo: true, name: 'broken', statusFlags: STATUS_ERROR, error: failure });
    owner(root, { memo: true, name: 'fine', value: 1 });

    const nodes = snapshot(root);

    expect(byName(nodes, 'broken')).toMatchObject({ errored: true, error: failure });
    expect(byName(nodes, 'fine')).toMatchObject({ errored: false, error: undefined });
  });

  it('tells store slot nodes from plain signals', () => {
    const root = owner(null, { component: 'StoreApp' });
    const store = { todos: [] };
    signal(root, 0, { name: 'count' });
    signal(root, store.todos, { name: 'todos', host: store });

    const nodes = snapshot(root);

    expect(byName(nodes, 'count')?.kind).toBe('signal');
    expect(byName(nodes, 'todos')?.kind).toBe('store');
  });

  it('hides runtime plumbing from the graph and from owner paths', () => {
    // The shape the hot reload wrapper creates: the component's root, an
    // unnamed plumbing memo, and the body's nodes under it.
    const root = owner(null, { component: 'HotApp' });
    const plumbing = owner(root, { memo: true, config: CONFIG_PLUMBING, value: undefined });
    const body = owner(plumbing, { component: 'Counter' });
    const count = signal(body, 0, { name: 'count' });
    const doubled = owner(body, { memo: true, name: 'doubled', value: 0 });
    link(count, plumbing);
    link(count, doubled);

    const nodes = snapshot(root);

    expect(nodes.map((node) => node.name).sort()).toEqual(['count', 'doubled']);
    expect(nodes.some((node) => node.raw === plumbing)).toBe(false);
    expect(byName(nodes, 'doubled')?.ownerPath).toEqual(['<HotApp>', '<Counter>']);
    expect(byName(nodes, 'count')?.ownerPath).toEqual(['<HotApp>', '<Counter>']);
    // Edges into the hidden node go with it.
    expect(byName(nodes, 'count')?.observers).toEqual([byName(nodes, 'doubled')!.id]);
  });
});
