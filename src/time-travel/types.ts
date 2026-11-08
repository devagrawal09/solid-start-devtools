import type {
  Accessor,
  ComputeFunction,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createSignal,
  createStore,
  MemoOptions,
  NoInfer,
  ProjectionOptions,
  Signal,
  SignalOptions,
  Store,
  StoreOptions,
  StoreSetter,
} from 'solid-js';

/**
 * Tracks a Solid primitive: `createTracked(createSignal, 0, { name: 'count' })`
 * returns what `createSignal(0, { name: 'count' })` returns, recorded on the
 * devtools' History panel and rewound by it. Supports `createSignal`,
 * `createOptimistic`, `createMemo`, `createStore`, `createOptimisticStore` and
 * `createProjection`. Name what you track: the name is how the panel shows it.
 * In production it is the primitive itself.
 */
export interface CreateTracked {
  <T>(
    create: typeof createSignal | typeof createOptimistic,
    value: Exclude<T, Function>,
    options?: SignalOptions<T>,
  ): Signal<T>;
  <T>(
    create: typeof createSignal | typeof createOptimistic,
    fn: ComputeFunction<T>,
    options?: SignalOptions<T> & MemoOptions<T>,
  ): Signal<T>;
  <T>(
    create: typeof createMemo,
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: MemoOptions<T>,
  ): Accessor<T>;
  <T extends object>(
    create: typeof createStore | typeof createOptimisticStore,
    value: T,
    options?: StoreOptions & { name?: string },
  ): [Store<T>, StoreSetter<T>];
  <T extends object>(
    create: typeof createProjection,
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: T,
    options?: ProjectionOptions,
  ): Store<T>;
}
