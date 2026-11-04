import { describe, expect, it } from 'vitest';
import type {
  ChangeOrigin,
  ChangeRecord,
  FlushEvent,
  InteractionEvent,
  RerunEvent,
} from 'solid-js/attribution';
import { timelineReport } from '../report/timeline-report.js';
import type { CallEvent } from '@solidjs/web';
import { callInteraction, isUnnamedUpdate, rootChanges, TimelineBuilder } from './tracker.js';

const click: ChangeOrigin = {
  kind: 'interaction',
  name: 'click',
  target: 'button#inc "count 0"',
  at: 100,
};

const write: ChangeRecord = {
  seq: 1,
  kind: 'write',
  name: 'count',
  nodeId: 5,
  prev: '0',
  value: '1',
  origin: click,
  at: 101,
};

const derived: ChangeRecord = {
  seq: 2,
  kind: 'derived',
  name: 'doubled',
  nodeId: 1,
  causes: [write],
};

function rerun(over: Partial<RerunEvent>): RerunEvent {
  return {
    run: 1,
    at: 102,
    nodeRuns: 1,
    nodeKind: 'memo',
    nodeName: 'doubled',
    nodeId: 1,
    causes: [write],
    depCount: 1,
    depsAdded: [],
    depsRemoved: [],
    selfMs: 0.2,
    totalMs: 0.2,
    changed: true,
    phase: 'plain',
    held: false,
    interaction: click,
    ...over,
  };
}

function flush(over: Partial<FlushEvent> = {}): FlushEvent {
  return { at: 102, durationMs: 1, runs: 2, created: 0, held: false, ...over } as FlushEvent;
}

function interaction(over: Partial<InteractionEvent> = {}): InteractionEvent {
  return {
    name: 'click',
    target: click.target,
    at: 100,
    inputDelayMs: 4,
    handlerMs: 1,
    writes: 1,
    runs: 2,
    created: 0,
    runMs: 0.5,
    holds: [],
    navigations: [],
    settledMs: 6,
    outcome: 'committed',
    origin: click,
    ...over,
  };
}

describe('rootChanges', () => {
  it('finds the writes a chain of derived changes bottoms out in, once each', () => {
    expect([...rootChanges([write, derived]).values()]).toEqual([write]);
  });
});

describe('TimelineBuilder', () => {
  it('groups the records of one interaction into one entry', () => {
    const builder = new TimelineBuilder();
    const node = {};
    builder.rerun(rerun({}), node);
    builder.rerun(
      rerun({ run: 2, nodeKind: 'effect', nodeName: 'title', nodeId: 2, causes: [derived] }),
      undefined,
    );
    builder.effect({
      at: 103,
      durationMs: 0.3,
      nodeId: 2,
      nodeName: 'title',
      run: 2,
      interaction: click,
    });
    builder.flush(flush({ interaction: click }));
    builder.interaction(interaction());

    const entries = builder.snapshot();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.label).toBe('click on button#inc "count 0"');
    expect(entry!.writes).toEqual([write]);
    expect(entry!.runs.map((run) => run.event.nodeName)).toEqual(['doubled', 'title']);
    expect(entry!.runs[0]!.node?.deref()).toBe(node);
    expect(entry!.runs[1]!.effectMs).toBe(0.3);
    expect(entry!.flushes).toBe(1);
    expect(entry!.interaction?.settledMs).toBe(6);
  });

  it('starts a new entry for each outside update, ended by its flush', () => {
    const builder = new TimelineBuilder();
    const timer: ChangeRecord = { ...write, seq: 9, name: 'clock', origin: { kind: 'external' } };
    builder.rerun(rerun({ interaction: undefined, causes: [timer] }), undefined);
    builder.flush(flush());
    builder.rerun(
      rerun({ run: 3, interaction: undefined, causes: [{ ...timer, seq: 10 }] }),
      undefined,
    );
    builder.flush(flush());

    const entries = builder.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.label).toBe('update: clock');
    expect(entries[0]!.origin).toBeUndefined();
  });

  it('leaves out an interaction that changed nothing', () => {
    const builder = new TimelineBuilder();
    builder.interaction(
      interaction({ writes: 0, runs: 0, origin: { kind: 'interaction', name: 'click' } }),
    );
    expect(builder.snapshot()).toHaveLength(0);
  });

  it('gives a changed entry a new object and keeps the rest', () => {
    const builder = new TimelineBuilder();
    const other: ChangeOrigin = { kind: 'interaction', name: 'keydown', at: 200 };
    builder.rerun(rerun({}), undefined);
    builder.rerun(rerun({ run: 2, interaction: other }), undefined);
    const first = builder.snapshot();
    builder.rerun(rerun({ run: 3 }), undefined);
    const second = builder.snapshot();

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1]!.runs).toHaveLength(2);
  });

  it('keeps the newest entries up to the limit', () => {
    const builder = new TimelineBuilder(2);
    for (const at of [1, 2, 3]) {
      builder.rerun(
        rerun({ run: at, interaction: { kind: 'interaction', name: `e${at}`, at } }),
        undefined,
      );
    }
    expect(builder.snapshot().map((entry) => entry.origin?.name)).toEqual(['e3', 'e2']);
  });
});

function call(over: Partial<CallEvent> = {}): CallEvent {
  return {
    id: 'load-user',
    name: 'loadUser',
    at: 105,
    durationMs: 40,
    method: 'POST',
    outcome: 'ok',
    status: 200,
    origin: click,
    ...over,
  };
}

describe('callInteraction', () => {
  it('finds the interaction behind the frame a call was made in', () => {
    expect(callInteraction(click)).toBe(click);
    expect(callInteraction({ kind: 'effect', name: 'sync', interaction: click })).toBe(click);
    expect(callInteraction({ kind: 'external' })).toBeUndefined();
    expect(callInteraction(undefined)).toBeUndefined();
  });
});

describe('TimelineBuilder calls', () => {
  it('puts a call under the interaction that made it', () => {
    const builder = new TimelineBuilder();
    builder.rerun(rerun({}), undefined);
    builder.call(
      call({ origin: { kind: 'effect', name: 'sync', interaction: click } }),
      'load-user#1',
    );
    const [entry] = builder.snapshot();
    expect(entry!.calls).toEqual([
      expect.objectContaining({
        instance: 'load-user#1',
        event: expect.objectContaining({ name: 'loadUser' }),
      }),
    ]);
  });

  it('keeps a click that only called the server', () => {
    const builder = new TimelineBuilder();
    builder.interaction(interaction({ writes: 0, runs: 0, outcome: 'idle' }));
    expect(builder.snapshot()).toHaveLength(0);

    builder.call(call(), 'load-user#1');
    const [entry] = builder.snapshot();
    expect(entry!.interaction?.outcome).toBe('idle');
    expect(entry!.calls).toHaveLength(1);
  });

  it('leaves calls no interaction made to the server-function panel', () => {
    const builder = new TimelineBuilder();
    builder.call(call({ origin: undefined }), undefined);
    expect(builder.snapshot()).toHaveLength(0);
  });
});

describe('isUnnamedUpdate', () => {
  it('marks updates no action caused that wrote only unnamed signals, or nothing', () => {
    const builder = new TimelineBuilder();
    const unnamed: ChangeRecord = {
      ...write,
      seq: 20,
      name: 'signal',
      origin: { kind: 'external' },
    };
    const named: ChangeRecord = { ...write, seq: 21, name: 'clock', origin: { kind: 'external' } };
    builder.rerun(rerun({ run: 1, interaction: undefined, causes: [unnamed] }), undefined);
    builder.flush(flush());
    builder.rerun(rerun({ run: 2, interaction: undefined, causes: [] }), undefined);
    builder.flush(flush());
    builder.rerun(rerun({ run: 3, interaction: undefined, causes: [named] }), undefined);
    builder.flush(flush());
    // The memo a `<Show>` keeps its children in.
    builder.rerun(
      rerun({ run: 4, interaction: undefined, causes: [{ ...unnamed, seq: 23, name: 'value' }] }),
      undefined,
    );
    builder.flush(flush());
    builder.rerun(rerun({ run: 5, causes: [{ ...unnamed, seq: 22, origin: click }] }), undefined);

    expect(builder.snapshot().map(isUnnamedUpdate)).toEqual([false, true, false, true, true]);
  });
});

describe('timelineReport', () => {
  it('lists the writes and each re-run with its causes', () => {
    const builder = new TimelineBuilder();
    builder.rerun(rerun({}), undefined);
    builder.rerun(
      rerun({ run: 2, nodeKind: 'effect', nodeName: 'title', causes: [derived], changed: false }),
      undefined,
    );
    builder.interaction(interaction());
    const report = timelineReport({ entry: builder.snapshot()[0]!, route: '/' });

    expect(report).toContain('# Solid update: `click on button#inc "count 0"`');
    expect(report).toContain('- Input delay: 4.0ms');
    expect(report).toContain('- Settled: 6.0ms after the event');
    expect(report).toContain('## Writes\n\n- write `count` 0 → 1');
    expect(report).toContain('- memo `doubled` (0.20ms)\n  - ← write `count` 0 → 1');
    expect(report).toContain(
      '- effect `title` (0.20ms, no change)\n  - ← `doubled` changed\n    - ← write `count` 0 → 1',
    );
  });

  it('lists the server calls of the action', () => {
    const builder = new TimelineBuilder();
    builder.rerun(rerun({}), undefined);
    builder.call(call(), undefined);
    builder.call(
      call({ name: 'save', outcome: 'error', status: undefined, durationMs: 12 }),
      undefined,
    );
    const report = timelineReport({ entry: builder.snapshot()[0]!, route: '/' });
    expect(report).toContain(
      '## Server calls\n\n- POST `loadUser` → 200 in 40.0ms\n- POST `save` → no response in 12.0ms, failed',
    );
  });

  it('hides the values of a write with a sensitive name', () => {
    const builder = new TimelineBuilder();
    const secret: ChangeRecord = { ...write, name: 'authToken', prev: 'a', value: 'b' };
    builder.rerun(rerun({ causes: [secret] }), undefined);
    const report = timelineReport({ entry: builder.snapshot()[0]!, route: '/' });
    expect(report).toContain('write `authToken` [redacted]');
    expect(report).not.toContain('a → b');
  });
});
