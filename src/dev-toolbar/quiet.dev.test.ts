import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  OBSERVE,
  untrack,
} from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { captureIssues, type IssueEvent } from './issues/tracker.js';
import { snapshotOwnershipTree, startOwnershipTracking } from './ownership/registry.js';
import { quietly } from './quiet.js';
import { snapshotReactivityGraph, startReactivityTracking } from './reactivity/registry.js';

// The label the runtime gives an untracked read it warns about, as in a component body.
const COMPONENT_BODY = 'a component body';

function strictReads(): string[] {
  const names: string[] = [];
  stops.push(
    OBSERVE!.diagnostics.subscribe((event) => {
      if (event.code === 'STRICT_READ_UNTRACKED') names.push(event.nodeName ?? '');
    }),
  );
  return names;
}

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

describe('the devtools reading the app', () => {
  it('raise no strict-read findings, even in an app effect callback', () => {
    stops.push(startReactivityTracking(), startOwnershipTracking());
    const reads = strictReads();
    const [count, setCount] = createSignal(0);
    createRoot((dispose) => {
      stops.push(dispose);
      untrack(() => {
        // The runtime lists the store's proxy beside the plain signals.
        const [state] = createStore({ items: [1, 2], label: 'x' });
        createEffect(
          () => count(),
          () => {
            // An effect callback is a strict-read scope. Reading the node fields
            // through the store's proxy here used to report `_flags`, `_time`...
            snapshotReactivityGraph();
            snapshotOwnershipTree();
            void state;
          },
        );
      }, COMPONENT_BODY);
    });
    flush();
    setCount(1);
    flush();
    expect(reads).toEqual([]);
  });

  it('leave what the runtime reports during a devtools read out of Health', async () => {
    const [state] = createRoot(() => createStore({ label: 'x' }));
    const captured: IssueEvent[] = [];
    stops.push(captureIssues((added) => captured.push(...added.map((entry) => entry.event))));
    const reads = strictReads();

    // A strict-read scope opened inside a devtools read still reports to the
    // console, but it is not the app's finding.
    quietly(() => untrack(() => state.label, COMPONENT_BODY));
    // The same read by the app is.
    untrack(() => state.label, COMPONENT_BODY);
    await Promise.resolve();

    expect(reads).toEqual(['label', 'label']);
    expect(captured.map((event) => event.nodeName)).toEqual(['label']);
  });
});
