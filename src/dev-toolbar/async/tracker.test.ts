import { describe, expect, it } from 'vitest';
import type { ChangeOrigin, FlightEvent, HoldEvent, WaterfallRecord } from 'solid-js/attribution';
import { asyncReport, asyncTitle } from '../report/async-report.js';
import { AsyncHistory, concernOf } from './tracker.js';

const click: ChangeOrigin = {
  kind: 'interaction',
  name: 'click',
  target: 'button#next "next"',
  at: 1,
};

function flight(over: Partial<FlightEvent> = {}): FlightEvent {
  return {
    nodeId: 2,
    nodeName: 'user',
    ownerPath: ['<DevToolbar>', '<AppScope>', 'computed', '<App>', 'user'],
    at: 10,
    durationMs: 120,
    outcome: 'landed',
    ...over,
  };
}

function hold(over: Partial<HoldEvent> = {}): HoldEvent {
  return {
    at: 5,
    holdMs: 250,
    tailMs: 240,
    flushes: 3,
    heldWrites: [{ name: 'userId', prev: '1', value: '2', origin: click }],
    blockers: ['user', 'posts'],
    acknowledgements: [],
    paintedDuringHold: 0,
    action: false,
    silent: true,
    long: false,
    interaction: click,
    ...over,
  } as HoldEvent;
}

describe('AsyncHistory', () => {
  it('keeps records newest first and remembers which nodes loaded', () => {
    const history = new AsyncHistory();
    const node = {};
    history.flight(flight(), node);
    history.hold(hold());

    expect(history.records.map((record) => record.type)).toEqual(['wait', 'load']);
    expect(history.isSource(node)).toBe(true);
    expect(history.isSource({})).toBe(false);
  });

  it('drops the toolbar owners from paths', () => {
    const history = new AsyncHistory();
    history.flight(flight(), undefined);
    const [record] = history.records;
    expect(record!.type === 'load' && record!.event.ownerPath).toEqual(['<App>', 'user']);
  });

  it('adds each chain once', () => {
    const history = new AsyncHistory();
    const chain: WaterfallRecord = {
      chain: [
        { name: 'user', ms: 120 },
        { name: 'posts', ms: 121 },
      ],
      sequentialMs: 241,
    };
    expect(history.chains([chain], 1)).toBe(true);
    expect(history.chains([chain], 2)).toBe(false);
    expect(history.records).toHaveLength(1);
  });

  it('keeps the newest records up to the limit', () => {
    const history = new AsyncHistory(2);
    for (const name of ['a', 'b', 'c']) history.flight(flight({ nodeName: name }), undefined);
    expect(history.records.map((record) => asyncTitle(record))).toEqual(['load c', 'load b']);
  });
});

describe('concernOf', () => {
  it('flags replaced loads, silent and long waits, flashes and chains', () => {
    const history = new AsyncHistory();
    history.flight(flight({ outcome: 'abandoned' }), undefined);
    history.hold(hold());
    history.hold(hold({ silent: false, long: true }));
    history.hold(hold({ silent: false }));
    history.fallback({ at: 1, shownMs: 90 }, undefined);
    history.fallback({ at: 1, shownMs: 400 }, undefined);
    history.chains([{ chain: [], sequentialMs: 0 }], 1);

    expect(history.records.map(concernOf).reverse()).toEqual([
      'replaced by a newer load',
      'no pending state shown',
      'long wait',
      undefined,
      'flash',
      undefined,
      'loads ran one after another',
    ]);
  });
});

describe('asyncReport', () => {
  it('describes a wait with what it held back and what the screen showed', () => {
    const history = new AsyncHistory();
    history.hold(hold());
    const report = asyncReport({ record: history.records[0]!, route: '/' });

    expect(report).toContain('# Solid async: `wait on user, posts`');
    expect(report).toContain('- Took: 250.0ms');
    expect(report).toContain('- Started by: `click on button#next "next"`');
    expect(report).toContain('- Concern: no pending state shown');
    expect(report).toContain('  - `userId` 1 → 2');
    expect(report).toContain('- Pending state shown by: nothing');
  });

  it('lists the loads of a chain in order', () => {
    const history = new AsyncHistory();
    history.chains(
      [
        {
          chain: [
            { name: 'user', ms: 120 },
            { name: 'posts', ms: 121 },
          ],
          sequentialMs: 241,
        },
      ],
      1,
    );
    const report = asyncReport({ record: history.records[0]!, route: '/' });
    expect(report).toContain('# Solid async: `chain user → posts`');
    expect(report).toContain('  - `user` 120.0ms\n  - `posts` 121.0ms');
  });

  it('hides held values with sensitive names', () => {
    const history = new AsyncHistory();
    history.hold(hold({ heldWrites: [{ name: 'password', prev: 'a', value: 'b' }] }));
    const report = asyncReport({ record: history.records[0]!, route: '/' });
    expect(report).toContain('`password` [redacted]');
    expect(report).not.toContain('a → b');
  });
});
