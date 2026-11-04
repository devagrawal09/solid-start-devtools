import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal, For, getOwner, onCleanup, Show } from 'solid-js';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { Text } from '../../ui/Text.js';
import { EyeIcon, TrashIcon, TreeIcon } from '../icons.js';
import {
  excludeReactiveOwner,
  snapshotReactivityGraph,
  startReactivityTracking,
  subscribeReactivityGraph,
  type ReactiveNode,
} from '../reactivity/registry.js';
import { asyncDuration, asyncOrigin, asyncReport, asyncTitle } from '../report/async-report.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { pageRoute } from '../report/markdown.js';
import { ms } from '../report/timeline-report.js';
import {
  concernOf,
  isAsyncAvailable,
  type AsyncHistory,
  type AsyncRecord,
  type AsyncRecordType,
} from './tracker.js';
import './styles.css';

const TYPES: { value: AsyncRecordType; label: string }[] = [
  { value: 'load', label: 'Loads' },
  { value: 'wait', label: 'Waits' },
  { value: 'fallback', label: 'Fallbacks' },
  { value: 'chain', label: 'Chains' },
];

/** How often the elapsed time of what is loading now is redrawn. */
const TICK_MS = 250;

interface LoadingNow {
  node: ReactiveNode;
  /** When the panel first saw it pending, on the `performance.now()` clock. */
  since: number;
}

export interface AsyncViewerProps {
  show?: boolean;
  history: AsyncHistory;
  records: AsyncRecord[];
  onClear: () => void;
  onViewInGraph?: (node: object) => void;
  onViewOwner?: (owner: object) => void;
}

export default function AsyncViewer(props: AsyncViewerProps): JSX.Element {
  // The live list reads the graph, which must not list the panel's own nodes.
  excludeReactiveOwner(getOwner());

  const [hidden, setHidden] = createSignal<AsyncRecordType[]>([]);
  const [selected, setSelected] = createSignal<number>();
  const [pending, setPending] = createSignal<ReactiveNode[]>([]);
  const [now, setNow] = createSignal(performance.now());
  const since = new Map<string, number>();

  // What is loading now comes from the graph, so it is read only while the panel shows.
  createEffect(
    () => !!props.show,
    (visible) => {
      if (!visible) return;
      const read = () => {
        const nodes = snapshotReactivityGraph().nodes.filter(
          (node) => node.pending && node.kind !== 'signal',
        );
        const ids = new Set(nodes.map((node) => node.id));
        for (const id of since.keys()) if (!ids.has(id)) since.delete(id);
        for (const node of nodes) if (!since.has(node.id)) since.set(node.id, performance.now());
        setPending(nodes);
      };
      const stop = startReactivityTracking();
      const unsubscribe = subscribeReactivityGraph(read);
      const timer = setInterval(() => setNow(performance.now()), TICK_MS);
      read();
      return () => {
        clearInterval(timer);
        unsubscribe();
        stop();
      };
    },
  );

  const loadingNow = createMemo<{ sources: LoadingNow[]; waiting: number }>(() => {
    const sources: LoadingNow[] = [];
    let waiting = 0;
    for (const node of pending()) {
      if (props.history.isSource(node.raw)) {
        sources.push({ node, since: since.get(node.id) ?? now() });
      } else {
        waiting++;
      }
    }
    return { sources, waiting };
  });

  const shown = createMemo(() => {
    const off = hidden();
    return props.records.filter((record) => !off.includes(record.type));
  });

  const selectedRecord = createMemo(() => {
    const id = selected();
    return id === undefined ? undefined : props.records.find((record) => record.id === id);
  });

  function toggleType(value: AsyncRecordType): void {
    setHidden((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  onCleanup(() => since.clear());

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-async-viewer>
          <div data-solid-async-nav>
            <div data-solid-async-filters>
              <For each={TYPES}>
                {(type) => (
                  <button
                    type="button"
                    data-solid-async-filter={type.value}
                    data-off={hidden().includes(type.value) ? '' : undefined}
                    aria-pressed={hidden().includes(type.value) ? 'false' : 'true'}
                    onClick={() => toggleType(type.value)}
                  >
                    <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>
                      {type.label}
                    </Text>
                  </button>
                )}
              </For>
            </div>
            <div data-solid-async-nav-actions>
              <Text data-solid-async-count options={{ size: 'xs', font: 'mono' }}>
                {`${shown().length} of ${props.records.length}`}
              </Text>
              <IconButton
                disabled={!props.records.length}
                onClick={() => {
                  setSelected(undefined);
                  props.onClear();
                }}
              >
                <TrashIcon title="Clear async history" />
              </IconButton>
            </div>
          </div>

          <div data-solid-async-body>
            <Show
              when={isAsyncAvailable()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>
                    The async panel needs a development build of solid-js.
                  </Text>
                </Placeholder>
              }
            >
              <div data-solid-async-main>
                <section data-solid-async-now>
                  <Text options={{ size: 'xs', weight: 'semibold' }}>Loading now</Text>
                  <Show
                    when={loadingNow().sources.length}
                    fallback={
                      <Text data-solid-async-note options={{ size: 'xs' }}>
                        {loadingNow().waiting
                          ? `${loadingNow().waiting} nodes are waiting on async work that has not loaded before.`
                          : 'Nothing is loading.'}
                      </Text>
                    }
                  >
                    <For each={loadingNow().sources}>
                      {(item) => (
                        <div data-solid-async-now-row>
                          <span data-solid-async-spinner aria-hidden="true" />
                          <Text
                            options={{
                              size: 'xs',
                              weight: 'semibold',
                              font: 'mono',
                              wrap: 'nowrap',
                            }}
                          >
                            {item.node.name}
                          </Text>
                          <Text
                            data-solid-async-muted
                            options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                          >
                            {item.node.ownerPath.join(' › ')}
                          </Text>
                          <Text
                            data-solid-async-elapsed
                            options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                          >
                            {ms(now() - item.since)}
                          </Text>
                          <Show when={props.onViewInGraph}>
                            <button
                              type="button"
                              data-solid-async-icon
                              aria-label="View in graph"
                              onClick={() => props.onViewInGraph?.(item.node.raw)}
                            >
                              <EyeIcon title="View in graph" />
                            </button>
                          </Show>
                        </div>
                      )}
                    </For>
                    <Show when={loadingNow().waiting}>
                      <Text data-solid-async-note options={{ size: 'xs' }}>
                        {`${loadingNow().waiting} more nodes are waiting on these.`}
                      </Text>
                    </Show>
                  </Show>
                </section>

                <div data-solid-async-list>
                  <Show
                    when={shown().length}
                    fallback={
                      <Placeholder>
                        <Text options={{ size: 'xs' }}>
                          {props.records.length
                            ? 'Nothing matches this filter.'
                            : 'Async loads, waits and fallbacks show up here once they finish.'}
                        </Text>
                      </Placeholder>
                    }
                  >
                    <For each={shown()}>
                      {(record) => (
                        <button
                          type="button"
                          data-solid-async-row
                          data-type={record.type}
                          data-concern={concernOf(record) ? '' : undefined}
                          data-selected={selected() === record.id ? '' : undefined}
                          onClick={() =>
                            setSelected((current) =>
                              current === record.id ? undefined : record.id,
                            )
                          }
                        >
                          <span data-solid-async-row-head>
                            <span data-solid-async-type={record.type}>{record.type}</span>
                            <Text
                              data-solid-async-row-title
                              options={{
                                size: 'xs',
                                weight: 'semibold',
                                font: 'mono',
                                wrap: 'nowrap',
                              }}
                            >
                              {asyncTitle(record)}
                            </Text>
                            <Text
                              data-solid-async-elapsed
                              options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                            >
                              {ms(asyncDuration(record))}
                            </Text>
                          </span>
                          <Show when={concernOf(record)}>
                            {(concern) => <Badge type="warning">{concern()}</Badge>}
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </div>

              <Show when={selectedRecord()}>
                {(record) => {
                  const node = () => {
                    const current = record();
                    return current.type === 'load' || current.type === 'fallback'
                      ? current.node?.deref()
                      : undefined;
                  };
                  return (
                    <aside data-solid-async-detail>
                      <div data-solid-async-detail-head>
                        <span data-solid-async-type={record().type}>{record().type}</span>
                        <Text options={{ size: 'sm', weight: 'semibold', font: 'mono' }}>
                          {asyncTitle(record())}
                        </Text>
                        <CopyReportButton
                          label={`this ${record().type}`}
                          report={() => asyncReport({ record: record(), route: pageRoute() })}
                        />
                      </div>
                      <Show when={concernOf(record())}>
                        {(concern) => <Badge type="warning">{concern()}</Badge>}
                      </Show>
                      <div data-solid-kv-table>
                        <div data-solid-kv-row>
                          <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                            Took
                          </Text>
                          <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                            {ms(asyncDuration(record()))}
                          </Text>
                        </div>
                        <Show when={asyncOrigin(record())}>
                          {(origin) => (
                            <div data-solid-kv-row>
                              <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                                Started by
                              </Text>
                              <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                                {origin()}
                              </Text>
                            </div>
                          )}
                        </Show>
                        <RecordRows record={record()} />
                      </div>
                      <Show when={node()}>
                        {(current) => (
                          <div data-solid-async-actions>
                            <Show when={props.onViewInGraph && record().type === 'load'}>
                              <button
                                type="button"
                                data-solid-async-action
                                onClick={() => props.onViewInGraph?.(current())}
                              >
                                <EyeIcon title="" aria-hidden="true" />
                                <Text options={{ size: 'xs', weight: 'semibold' }}>
                                  Show in the reactivity graph
                                </Text>
                              </button>
                            </Show>
                            <Show when={props.onViewOwner}>
                              <button
                                type="button"
                                data-solid-async-action
                                onClick={() => props.onViewOwner?.(current())}
                              >
                                <TreeIcon title="" aria-hidden="true" />
                                <Text options={{ size: 'xs', weight: 'semibold' }}>
                                  Show in the ownership tree
                                </Text>
                              </button>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </aside>
                  );
                }}
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div data-solid-kv-row>
      <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
        {props.label}
      </Text>
      <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
        {props.children}
      </Text>
    </div>
  );
}

/** The fields a record has beyond its title and time. */
function RecordRows(props: { record: AsyncRecord }): JSX.Element {
  return (
    <>
      {(() => {
        const record = props.record;
        switch (record.type) {
          case 'load':
            return (
              <>
                <Row label="Outcome">
                  {record.event.outcome === 'landed' ? 'landed' : 'replaced by a newer load'}
                </Row>
                <Show when={record.event.ownerPath?.length}>
                  <Row label="Owner">{record.event.ownerPath!.join(' › ')}</Row>
                </Show>
              </>
            );
          case 'wait':
            return (
              <>
                <Row label="Waited on">{record.event.blockers.join(', ') || 'unknown'}</Row>
                <Row label="Held writes">
                  {record.event.heldWrites
                    .map((write) =>
                      write.value === undefined
                        ? write.name
                        : `${write.name} ${write.prev ?? ''} → ${write.value}`,
                    )
                    .join(', ') || 'none'}
                </Row>
                <Row label="Pending UI">
                  {record.event.acknowledgements.length
                    ? record.event.acknowledgements
                        .map((ack) => `${ack.kind}(${ack.source})`)
                        .join(', ')
                    : 'none shown'}
                </Row>
              </>
            );
          case 'fallback':
            return (
              <Show when={record.event.ownerPath?.length}>
                <Row label="Boundary">{record.event.ownerPath!.join(' › ')}</Row>
              </Show>
            );
          case 'chain':
            return (
              <Row label="Loads">
                {record.event.chain.map((link) => `${link.name} ${ms(link.ms)}`).join(' → ')}
              </Row>
            );
        }
      })()}
    </>
  );
}
