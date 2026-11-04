import { OBSERVE } from 'solid-js';
import {
  attribution,
  type FallbackEvent,
  type FlightEvent,
  type HoldEvent,
  type WaterfallRecord,
} from 'solid-js/attribution';
import { appOwnerPath } from '../issues/tracker.js';

/** A fallback shown for less than this reads as a flash, as the runtime's `FALLBACK_FLASH` finding counts it. */
export const FLASH_MS = 150;

/** Most records the panel keeps. The oldest go first. */
export const MAX_RECORDS = 200;

/** One thing that happened while the app waited on async work. */
export type AsyncRecord =
  | {
      /** An async computation loaded, or was replaced by a newer load. */
      type: 'load';
      id: number;
      at: number;
      event: FlightEvent;
      node: WeakRef<object> | undefined;
    }
  | {
      /** Writes were held back until async work they depend on settled. */
      type: 'wait';
      id: number;
      at: number;
      event: HoldEvent;
    }
  | {
      /** A `<Loading>` boundary showed its fallback. */
      type: 'fallback';
      id: number;
      at: number;
      event: FallbackEvent;
      node: WeakRef<object> | undefined;
    }
  | {
      /** Loads that ran one after another, each starting when the one before landed. */
      type: 'chain';
      id: number;
      at: number;
      event: WaterfallRecord;
    };

export type AsyncRecordType = AsyncRecord['type'];

/** What makes a record worth a look, if anything. */
export function concernOf(record: AsyncRecord): string | undefined {
  switch (record.type) {
    case 'load':
      return record.event.outcome === 'abandoned' ? 'replaced by a newer load' : undefined;
    case 'wait':
      if (record.event.silent) return 'no pending state shown';
      if (record.event.long) return 'long wait';
      return undefined;
    case 'fallback':
      return record.event.shownMs < FLASH_MS ? 'flash' : undefined;
    case 'chain':
      return 'loads ran one after another';
  }
}

/** Collects the async records, newest first. */
export class AsyncHistory {
  records: AsyncRecord[] = [];
  private nextId = 1;
  /** The async nodes that loaded at least once, so the live list can tell sources from waiters. */
  private sources = new WeakSet<object>();
  private seenChains = new WeakSet<WaterfallRecord>();

  constructor(private readonly max = MAX_RECORDS) {}

  private add(record: AsyncRecord): void {
    this.records = [record, ...this.records].slice(0, this.max);
  }

  flight(event: FlightEvent, node: object | undefined): void {
    if (node) this.sources.add(node);
    this.add({
      type: 'load',
      id: this.nextId++,
      at: event.at,
      event: { ...event, ownerPath: appOwnerPath(event.ownerPath) },
      node: node ? new WeakRef(node) : undefined,
    });
  }

  hold(event: HoldEvent): void {
    const acknowledgements = event.acknowledgements.map((ack) => ({
      ...ack,
      reader: appOwnerPath(ack.reader),
    }));
    this.add({
      type: 'wait',
      id: this.nextId++,
      at: event.at,
      event: { ...event, acknowledgements },
    });
  }

  fallback(event: FallbackEvent, node: object | undefined): void {
    this.add({
      type: 'fallback',
      id: this.nextId++,
      at: event.at,
      event: { ...event, ownerPath: appOwnerPath(event.ownerPath) },
      node: node ? new WeakRef(node) : undefined,
    });
  }

  /** Adds the chains the runtime found that this history has not seen yet. */
  chains(found: readonly WaterfallRecord[], at: number): boolean {
    let added = false;
    for (const chain of found) {
      if (this.seenChains.has(chain)) continue;
      this.seenChains.add(chain);
      this.add({ type: 'chain', id: this.nextId++, at, event: chain });
      added = true;
    }
    return added;
  }

  isSource(node: object): boolean {
    return this.sources.has(node);
  }

  clear(): void {
    this.records = [];
  }
}

/** True when the runtime reports async work, which is in dev and observe builds. */
export function isAsyncAvailable(): boolean {
  return !!OBSERVE?.records && typeof attribution?.enable === 'function';
}

/**
 * Feeds the runtime's async records to a history. The attribution engine
 * makes them, so this takes a hold on it. The records arrive inside the
 * runtime's own work, so the panel hears about them on a microtask. Returns
 * the stop.
 */
export function startAsyncCapture(history: AsyncHistory, onChange: () => void): () => void {
  if (!isAsyncAvailable()) return () => {};
  const records = OBSERVE!.records;
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      // The runtime stores a chain after it sends the record of the load that ended it,
      // and only its history buffer holds chains, so the buffer is read here.
      history.chains(attribution.history('waterfall'), performance.now());
      onChange();
    });
  };
  const offs = [
    records.subscribe('flight', (event, node) => {
      history.flight(event, node as object | undefined);
      changed();
    }),
    records.subscribe('hold', (event) => {
      history.hold(event);
      changed();
    }),
    records.subscribe('fallback', (event, node) => {
      history.fallback(event, node as object | undefined);
      changed();
    }),
  ];
  const release = attribution.enable({ log: false, values: 'full' });
  return () => {
    release();
    for (const off of offs) off();
  };
}
