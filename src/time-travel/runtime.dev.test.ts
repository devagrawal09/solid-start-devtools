import { beforeEach, describe, expect, it } from 'vitest';
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  createStore,
  flush,
  OBSERVE,
} from 'solid-js';
import { attribution } from 'solid-js/attribution';
import { createTracked, getTimeline } from './index.js';

/** Whether this solid-js reports what each drain changed (`FlushEvent.changes`). */
function reportsChanges(): boolean {
  if (!OBSERVE) return false;
  let found = false;
  const release = attribution.enable({ log: false, checks: false });
  const off = OBSERVE.records.subscribe('flush', (event) => {
    found ||= Array.isArray((event as { changes?: unknown }).changes);
  });
  const [value, setValue] = createSignal(0);
  const dispose = createRoot((dispose) => {
    createEffect(value, () => {});
    return dispose;
  });
  flush();
  setValue(1);
  flush();
  dispose();
  off();
  release();
  return found;
}

const supported = reportsChanges();

async function settled(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flush();
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const brief = () => (getTimeline()?.steps() ?? []).map(({ id, changes }) => ({ id, changes }));

describe.skipIf(!supported)('time travel', () => {
  beforeEach(async () => {
    getTimeline()?.resume();
    await settled();
    getTimeline()?.clear();
  });

  it('records one step per drain, two for two synchronous flushes', async () => {
    const [, setA] = createRoot(() => createTracked(createSignal, 0, { name: 'a' }));
    const [, setB] = createRoot(() => createTracked(createSignal, 'x', { name: 'b' }));
    await settled();
    setA(1);
    setB('y');
    await settled();
    setA(2);
    flush();
    setA(3);
    flush();
    await settled();
    expect(brief()).toEqual([
      { id: 1, changes: { a: 1, b: 'y' } },
      { id: 2, changes: { a: 2 } },
      { id: 3, changes: { a: 3 } },
    ]);
  });

  it('shows a past step without writing it, and returns to the present', async () => {
    const { count, setCount, doubled } = createRoot(() => {
      const [count, setCount] = createTracked(createSignal, 0, { name: 'count' });
      const doubled = createMemo(() => count() * 2);
      createEffect(doubled, () => {});
      return { count, setCount, doubled };
    });
    await settled();
    for (const value of [1, 2, 3]) {
      setCount(value);
      await settled();
    }
    const timeline = getTimeline()!;
    timeline.goto(1);
    await settled();
    expect(timeline.traveling()).toBe(true);
    expect([count(), doubled()]).toEqual([1, 2]);
    // A write during travel goes to the present and is recorded there.
    setCount(10);
    await settled();
    expect(count()).toBe(1);
    timeline.resume();
    await settled();
    expect([count(), doubled()]).toEqual([10, 20]);
    expect(brief().map((step) => step.changes.count)).toEqual([1, 2, 3, 10]);
  });

  it('rewinds a store row by row', async () => {
    let firstRuns = 0;
    const { state, setState } = createRoot(() => {
      const [state, setState] = createTracked(
        createStore,
        {
          rows: [
            { id: 1, text: 'a' },
            { id: 2, text: 'b' },
          ],
        },
        { name: 'todos' },
      );
      createEffect(
        () => state.rows[0].text,
        () => {
          firstRuns++;
        },
      );
      return { state, setState };
    });
    await settled();
    setState((draft) => {
      draft.rows[0].text = 'A';
    });
    await settled();
    setState((draft) => {
      draft.rows[1].text = 'B';
    });
    await settled();
    const timeline = getTimeline()!;
    const row = state.rows[0];
    const runs = firstRuns;
    timeline.goto(1);
    await settled();
    expect([state.rows[0].text, state.rows[1].text]).toEqual(['A', 'b']);
    expect(state.rows[0]).toBe(row);
    expect(firstRuns).toBe(runs);
    timeline.resume();
    await settled();
    expect(state.rows[1].text).toBe('B');
  });

  it("records an action's held write at its landing, named after the action", async () => {
    const [saved, setSaved] = createRoot(() =>
      createTracked(createSignal, 'draft', { name: 'saved' }),
    );
    await settled();
    const submit = action(function* save() {
      setSaved('final');
      yield delay(10);
    });
    const done = submit();
    await settled();
    expect(brief()).toEqual([]);
    await done;
    await settled();
    expect(saved()).toBe('final');
    expect(getTimeline()!.steps()).toEqual([
      expect.objectContaining({ id: 1, changes: { saved: 'final' }, actions: ['save'] }),
    ]);
  });

  it('records an optimistic value when it appears and when it lifts', async () => {
    const [status, setStatus] = createRoot(() => {
      const signal = createTracked(createOptimistic, 'idle', { name: 'status' });
      createEffect(signal[0], () => {});
      return signal;
    });
    await settled();
    const submit = action(function* save() {
      setStatus('saving');
      yield delay(10);
    });
    const done = submit();
    await settled();
    expect(status()).toBe('saving');
    await done;
    await settled();
    expect(
      getTimeline()!
        .steps()
        .map((step) => [step.changes, step.actions]),
    ).toEqual([
      [{ status: 'saving' }, ['save']],
      [{ status: 'idle' }, []],
    ]);
  });

  it('branches from a past step', async () => {
    const [x, setX] = createRoot(() => createTracked(createSignal, 0, { name: 'x' }));
    await settled();
    setX(1);
    await settled();
    setX(2);
    await settled();
    const timeline = getTimeline()!;
    timeline.goto(1);
    await settled();
    timeline.branch();
    await settled();
    expect(timeline.traveling()).toBe(false);
    expect(x()).toBe(1);
    expect(brief()).toEqual([{ id: 1, changes: { x: 1 } }]);
    setX(5);
    await settled();
    expect(brief()).toEqual([
      { id: 1, changes: { x: 1 } },
      { id: 2, changes: { x: 5 } },
    ]);
  });

  it('names the interaction behind a step', async () => {
    const [, setCount] = createRoot(() => createTracked(createSignal, 0, { name: 'clicks' }));
    await settled();
    OBSERVE!.attribution.withInteraction({ type: 'click', target: 'button#inc' }, () =>
      setCount(1),
    );
    await settled();
    expect(getTimeline()!.steps()).toEqual([
      expect.objectContaining({ cause: 'click on button#inc' }),
    ]);
  });
});

describe('time travel without support', () => {
  it('still returns working primitives', async () => {
    const [count, setCount] = createRoot(() => createTracked(createSignal, 1, { name: 'plain' }));
    setCount(2);
    await settled();
    expect(count()).toBe(2);
  });
});
