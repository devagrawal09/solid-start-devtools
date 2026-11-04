import type { CallEvent } from '@solidjs/web';
import { OBSERVE } from 'solid-js';
import { instanceOfCall } from '../functions/records.js';
import {
  attribution,
  formatOrigin,
  type ChangeOrigin,
  type ChangeRecord,
  type EffectRunEvent,
  type FlushEvent,
  type HoldEvent,
  type InteractionEvent,
  type NavigationEvent,
  type RerunEvent,
} from 'solid-js/attribution';

/** One re-run of a memo or an effect, with the time its effect callback took. */
export interface TimelineRun {
  event: RerunEvent;
  /** The runtime node, held weakly so the graph can be pointed at it. */
  node: WeakRef<object> | undefined;
  /** Time of the effect callback that followed the compute run, for an effect. */
  effectMs: number | undefined;
}

/** One server-function call the action made. */
export interface TimelineCall {
  event: CallEvent;
  /** The server-function panel's key for the call, so the panel can show it. */
  instance: string | undefined;
}

/**
 * What one user action, or one update from outside the app's handlers, made
 * the app do: the writes it started with and every re-run they caused.
 */
export interface TimelineEntry {
  id: number;
  /**
   * The interaction the records trace back to. The runtime hands the same
   * object to every record of one interaction, so it is the key the records
   * are grouped by. `undefined` for an update from a timer, a promise or
   * another callback the runtime does not know as an interaction.
   */
  origin: ChangeOrigin | undefined;
  label: string;
  /** When the action began, on the `performance.now()` clock. */
  at: number;
  /** The interaction record, which the runtime sends once the update has settled. */
  interaction: InteractionEvent | undefined;
  /** The writes the re-runs bottom out in, in order. */
  writes: ChangeRecord[];
  runs: TimelineRun[];
  /** Re-runs left out once the entry held `MAX_RUNS`. */
  droppedRuns: number;
  flushes: number;
  flushMs: number;
  holds: HoldEvent[];
  navigations: NavigationEvent[];
  calls: TimelineCall[];
}

/** Most entries the panel keeps. The oldest go first. */
export const MAX_ENTRIES = 100;
/** Most re-runs one entry keeps. */
export const MAX_RUNS = 300;

/**
 * The interaction a call ran for. A call made by a handler carries the
 * interaction itself. One made for an effect, a navigation or a landing
 * carries that frame, which names the interaction behind it.
 */
export function callInteraction(origin: ChangeOrigin | undefined): ChangeOrigin | undefined {
  if (!origin) return undefined;
  return origin.kind === 'interaction' ? origin : origin.interaction;
}

/** The writes, landings and refreshes a cause chain bottoms out in. */
export function rootChanges(causes: ChangeRecord[], out = new Map<number, ChangeRecord>()) {
  for (const cause of causes) {
    if (cause.causes?.length) rootChanges(cause.causes, out);
    else if (!out.has(cause.seq)) out.set(cause.seq, cause);
  }
  return out;
}

/**
 * The names the runtime gives a signal or a memo created without a `name`
 * option, and the names it gives the memos inside its own components, such
 * as the `value` of a `<Show>`.
 */
const DEFAULT_NAMES = new Set([
  'signal',
  'computed',
  'memo',
  'value',
  'condition',
  'condition value',
  'conditions',
  'eval conditions',
  'children',
  'boundary',
  'reveal order',
]);

/**
 * An update no action caused whose writes all went to unnamed signals, or
 * that wrote nothing. Most come from the runtime's own state, such as the
 * condition of a `<Show>` or a `<Loading>` boundary settling, so the panel
 * hides them unless asked. An app's own unnamed signal looks the same, which
 * is why they are hidden and not dropped.
 */
export function isUnnamedUpdate(entry: TimelineEntry): boolean {
  return !entry.origin && entry.writes.every((write) => DEFAULT_NAMES.has(write.name));
}

function externalLabel(writes: ChangeRecord[]): string {
  const origin = writes.find((write) => write.origin)?.origin;
  const source = origin && origin.kind !== 'external' ? formatOrigin(origin) : 'update';
  const names = [...new Set(writes.map((write) => write.name))];
  return names.length ? `${source}: ${names.join(', ')}` : source;
}

/**
 * Builds the timeline from the runtime's records. Pure apart from the clock
 * values in the records, so it can be fed by hand in tests.
 */
export class TimelineBuilder {
  entries: TimelineEntry[] = [];
  private nextId = 1;
  private byOrigin = new WeakMap<ChangeOrigin, TimelineEntry>();
  /** The entry collecting re-runs that no interaction caused, until its flush ends. */
  private external: TimelineEntry | undefined;
  private changed = new Set<TimelineEntry>();
  /**
   * Interactions that changed nothing, kept aside. A click that only calls
   * the server looks idle when its record arrives, and its call settles later.
   */
  private idle = new WeakMap<ChangeOrigin, InteractionEvent>();

  constructor(private readonly max = MAX_ENTRIES) {}

  private create(origin: ChangeOrigin | undefined, at: number): TimelineEntry {
    const entry: TimelineEntry = {
      id: this.nextId++,
      origin,
      label: origin ? formatOrigin(origin) : 'update',
      at: origin?.at ?? at,
      interaction: undefined,
      writes: [],
      runs: [],
      droppedRuns: 0,
      flushes: 0,
      flushMs: 0,
      holds: [],
      navigations: [],
      calls: [],
    };
    this.entries.unshift(entry);
    for (const dropped of this.entries.splice(this.max)) {
      if (dropped.origin) this.byOrigin.delete(dropped.origin);
      if (dropped === this.external) this.external = undefined;
    }
    if (origin) this.byOrigin.set(origin, entry);
    return entry;
  }

  private entryFor(origin: ChangeOrigin | undefined, at: number): TimelineEntry {
    if (origin) return this.byOrigin.get(origin) ?? this.create(origin, at);
    this.external ??= this.create(undefined, at);
    return this.external;
  }

  private touch(entry: TimelineEntry): void {
    this.changed.add(entry);
  }

  rerun(event: RerunEvent, node: object | undefined): void {
    const entry = this.entryFor(event.interaction, event.at);
    const known = new Set(entry.writes.map((write) => write.seq));
    for (const root of rootChanges(event.causes).values()) {
      if (!known.has(root.seq)) entry.writes.push(root);
    }
    if (!entry.origin) entry.label = externalLabel(entry.writes);
    if (entry.runs.length < MAX_RUNS) {
      entry.runs.push({ event, node: node ? new WeakRef(node) : undefined, effectMs: undefined });
    } else {
      entry.droppedRuns++;
    }
    this.touch(entry);
  }

  effect(event: EffectRunEvent): void {
    if (event.run === undefined) return;
    const entry = this.entryFor(event.interaction, event.at);
    const run = entry.runs.find((item) => item.event.run === event.run);
    if (!run) return;
    run.effectMs = (run.effectMs ?? 0) + event.durationMs;
    this.touch(entry);
  }

  flush(event: FlushEvent): void {
    // A flush with nothing in it says nothing about an action.
    if (!event.runs && !event.created) {
      if (!event.interaction) this.external = undefined;
      return;
    }
    const entry = this.entryFor(event.interaction, event.at);
    entry.flushes++;
    entry.flushMs += event.durationMs;
    // The re-runs of an outside update end with its flush, so the next ones start a new entry.
    if (!event.interaction) this.external = undefined;
    this.touch(entry);
  }

  interaction(event: InteractionEvent): void {
    // A click on something that reads no state, such as the devtools themselves.
    const idle = !event.writes && !event.runs && !event.created && !event.holds.length;
    if (idle && !this.byOrigin.has(event.origin)) {
      this.idle.set(event.origin, event);
      return;
    }
    const entry = this.entryFor(event.origin, event.at);
    entry.interaction = event;
    entry.at = event.at;
    this.touch(entry);
  }

  hold(event: HoldEvent): void {
    const entry = this.entryFor(event.interaction, event.at);
    entry.holds.push(event);
    this.touch(entry);
  }

  /**
   * A server-function call joins the action it ran for. A call that no
   * interaction made is left to the server-function panel.
   */
  call(event: CallEvent, instance: string | undefined): void {
    const origin = callInteraction(event.origin);
    if (!origin) return;
    const entry = this.entryFor(origin, event.at);
    const idle = this.idle.get(origin);
    if (idle && !entry.interaction) {
      entry.interaction = idle;
      entry.at = idle.at;
    }
    entry.calls.push({ event, instance });
    this.touch(entry);
  }

  navigation(event: NavigationEvent): void {
    const entry = this.entryFor(event.interaction ?? event.origin, event.at);
    entry.navigations.push(event);
    this.touch(entry);
  }

  /**
   * The entries for the panel. An entry that changed since the last call is a
   * new object, so the panel redraws only what moved.
   */
  snapshot(): TimelineEntry[] {
    if (!this.changed.size) return this.entries;
    this.entries = this.entries.map((entry) => {
      if (!this.changed.has(entry)) return entry;
      const copy = {
        ...entry,
        writes: entry.writes.slice(),
        runs: entry.runs.slice(),
        holds: entry.holds.slice(),
        navigations: entry.navigations.slice(),
        calls: entry.calls.slice(),
      };
      // Later records find the entry through its origin, so they reach the copy.
      if (copy.origin) this.byOrigin.set(copy.origin, copy);
      if (this.external === entry) this.external = copy;
      return copy;
    });
    this.changed.clear();
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.byOrigin = new WeakMap();
    this.idle = new WeakMap();
    this.external = undefined;
    this.changed.clear();
  }
}

/** True when the runtime can explain re-runs, which is in dev and observe builds. */
export function isTimelineAvailable(): boolean {
  return !!OBSERVE?.records && typeof attribution?.enable === 'function';
}

/**
 * Turns on the runtime's attribution engine and feeds its records to a
 * builder. The engine's records arrive inside the runtime's own work, where a
 * signal write would be part of what it measures, so the panel hears about
 * changes on a microtask. Returns the stop.
 */
export function startTimeline(builder: TimelineBuilder, onChange: () => void): () => void {
  if (!isTimelineAvailable()) return () => {};
  const records = OBSERVE!.records;
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      onChange();
    });
  };
  const offs = [
    records.subscribe('rerun', (event, node) => {
      builder.rerun(event, node as object | undefined);
      changed();
    }),
    records.subscribe('effect', (event) => {
      builder.effect(event);
      changed();
    }),
    records.subscribe('flush', (event) => {
      builder.flush(event);
      changed();
    }),
    records.subscribe('interaction', (event) => {
      builder.interaction(event);
      changed();
    }),
    records.subscribe('hold', (event) => {
      builder.hold(event);
      changed();
    }),
    records.subscribe('navigation', (event) => {
      builder.navigation(event);
      changed();
    }),
    records.subscribe('call', (event, live) => {
      // The server-function panel listens from the moment the package loads, so
      // it has given the call its key by now. The live object itself is not
      // kept, since nothing else holds it once the call settled.
      builder.call(event, instanceOfCall(live));
      changed();
    }),
  ];
  // The console log stays off: the panel is where the re-runs are read.
  const release = attribution.enable({ log: false, values: 'full' });
  return () => {
    release();
    for (const off of offs) off();
  };
}
