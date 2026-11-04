import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ChangeRecord } from 'solid-js/attribution';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { Text } from '../../ui/Text.js';
import { EyeIcon, TrashIcon } from '../icons.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { pageRoute } from '../report/markdown.js';
import { ms, plural, timelineReport } from '../report/timeline-report.js';
import {
  isTimelineAvailable,
  isUnnamedUpdate,
  type TimelineCall,
  type TimelineEntry,
  type TimelineRun,
} from './tracker.js';
import './styles.css';

function outcomeBadge(entry: TimelineEntry): JSX.Element {
  const outcome = entry.interaction?.outcome;
  if (outcome === 'held') return <Badge type="warning">held</Badge>;
  if (outcome === 'committed') return <Badge type="success">committed</Badge>;
  if (entry.origin && !entry.interaction) return <Badge type="info">pending</Badge>;
  return <Badge type="info">{entry.origin ? (outcome ?? 'idle') : 'update'}</Badge>;
}

/** The total time of the entry: the interaction's settle time, else its flushes. */
function duration(entry: TimelineEntry): number {
  return entry.interaction?.settledMs ?? entry.flushMs;
}

function runCount(entry: TimelineEntry): number {
  return entry.interaction?.runs ?? entry.runs.length + entry.droppedRuns;
}

/** `0 → 1` for a write, with the values the runtime previewed. */
function WriteText(props: { change: ChangeRecord }): JSX.Element {
  return (
    <>
      <span data-solid-timeline-change-kind>{props.change.kind}</span>
      <Text options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}>
        {props.change.name}
      </Text>
      <Show when={props.change.value !== undefined}>
        <Text data-solid-timeline-change-value options={{ size: 'xs', font: 'mono' }}>
          {props.change.prev === undefined
            ? props.change.value!
            : `${props.change.prev} → ${props.change.value}`}
        </Text>
      </Show>
    </>
  );
}

/** Why a run happened: the changes it saw, each with the changes behind it. */
function CauseTree(props: { causes: ChangeRecord[] }): JSX.Element {
  return (
    <ul data-solid-timeline-causes>
      <For each={props.causes}>
        {(cause) => (
          <li>
            <span data-solid-timeline-cause>
              <span data-solid-timeline-arrow>←</span>
              <Show when={cause.kind === 'derived'} fallback={<WriteText change={cause} />}>
                <Text options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
                  {`${cause.name} changed`}
                </Text>
              </Show>
            </span>
            <Show when={cause.causes?.length}>
              <CauseTree causes={cause.causes!} />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

interface RunRowProps {
  run: TimelineRun;
  open: boolean;
  onToggle: () => void;
  onViewInGraph?: (node: object) => void;
}

function RunRow(props: RunRowProps): JSX.Element {
  const node = () => props.run.node?.deref();
  return (
    <div data-solid-timeline-run data-open={props.open ? '' : undefined}>
      <div data-solid-timeline-run-head>
        <button
          type="button"
          data-solid-timeline-run-toggle
          aria-expanded={props.open ? 'true' : 'false'}
          onClick={props.onToggle}
        >
          <span data-solid-timeline-kind={props.run.event.nodeKind} />
          <Text options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}>
            {props.run.event.nodeName}
          </Text>
          <Show when={!props.run.event.changed}>
            <Badge type="warning">no change</Badge>
          </Show>
          <Show when={props.run.event.phase !== 'plain'}>
            <Badge type="info">{props.run.event.phase}</Badge>
          </Show>
          <Text data-solid-timeline-run-time options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
            {props.run.effectMs === undefined
              ? ms(props.run.event.selfMs)
              : `${ms(props.run.event.selfMs)} + ${ms(props.run.effectMs)}`}
          </Text>
        </button>
        <Show when={props.onViewInGraph && node()}>
          {(current) => (
            <button
              type="button"
              data-solid-timeline-view-graph
              aria-label="View in graph"
              onClick={() => props.onViewInGraph?.(current())}
            >
              <EyeIcon title="View in graph" />
            </button>
          )}
        </Show>
      </div>
      <Show when={props.open}>
        <Show
          when={props.run.event.causes.length}
          fallback={
            <Text data-solid-timeline-note options={{ size: 'xs' }}>
              No tracked change caused this run, such as a retry after an error.
            </Text>
          }
        >
          <CauseTree causes={props.run.event.causes} />
        </Show>
      </Show>
    </div>
  );
}

function CallRow(props: {
  call: TimelineCall;
  onViewCall?: (instance: string) => void;
}): JSX.Element {
  const status = () =>
    props.call.event.status === undefined ? 'ERR' : String(props.call.event.status);
  const content = (
    <>
      <Badge type="info">{props.call.event.method}</Badge>
      <Text options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}>
        {props.call.event.name ?? props.call.event.id}
      </Text>
      <Badge type={props.call.event.outcome === 'ok' ? 'success' : 'failure'}>{status()}</Badge>
      <Text data-solid-timeline-run-time options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
        {ms(props.call.event.durationMs)}
      </Text>
    </>
  );
  return (
    <Show
      when={props.onViewCall && props.call.instance}
      fallback={<span data-solid-timeline-call>{content}</span>}
    >
      {(current) => (
        <button
          type="button"
          data-solid-timeline-call
          title="Show in the server-function panel"
          onClick={() => props.onViewCall?.(current())}
        >
          {content}
        </button>
      )}
    </Show>
  );
}

export interface TimelineViewerProps {
  show?: boolean;
  entries: TimelineEntry[];
  onClear: () => void;
  /** Opens a memo or an effect in the reactivity graph. */
  onViewInGraph?: (node: object) => void;
  /** Opens a server-function call in its panel, by the panel's key for it. */
  onViewCall?: (instance: string) => void;
}

export default function TimelineViewer(props: TimelineViewerProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [showUnnamed, setShowUnnamed] = createSignal(false);
  const [selected, setSelected] = createSignal<number>();
  const [openRuns, setOpenRuns] = createSignal<number[]>([]);

  const unnamedCount = createMemo(() => props.entries.filter(isUnnamedUpdate).length);

  const shown = createMemo(() => {
    const search = query().trim().toLowerCase();
    const entries = showUnnamed()
      ? props.entries
      : props.entries.filter((entry) => !isUnnamedUpdate(entry));
    if (!search) return entries;
    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(search) ||
        entry.writes.some((write) => write.name.toLowerCase().includes(search)) ||
        entry.runs.some((run) => run.event.nodeName.toLowerCase().includes(search)),
    );
  });

  const selectedEntry = createMemo(() => {
    const id = selected();
    return id === undefined ? undefined : props.entries.find((entry) => entry.id === id);
  });

  function select(id: number): void {
    setOpenRuns([]);
    setSelected((current) => (current === id ? undefined : id));
  }

  function toggleRun(run: number): void {
    setOpenRuns((current) =>
      current.includes(run) ? current.filter((item) => item !== run) : [...current, run],
    );
  }

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-timeline-viewer>
          <div data-solid-timeline-nav>
            <input
              data-solid-timeline-search
              type="search"
              placeholder="Filter by action, signal or computation"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Show when={unnamedCount()}>
              <button
                type="button"
                data-solid-timeline-unnamed
                aria-pressed={showUnnamed() ? 'true' : 'false'}
                title="Updates no action caused, whose writes all went to unnamed signals"
                onClick={() => setShowUnnamed((current) => !current)}
              >
                <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>
                  {`${showUnnamed() ? 'Hide' : 'Show'} ${plural(unnamedCount(), 'unnamed update')}`}
                </Text>
              </button>
            </Show>
            <div data-solid-timeline-nav-actions>
              <Text data-solid-timeline-count options={{ size: 'xs', font: 'mono' }}>
                {`${shown().length} of ${props.entries.length}`}
              </Text>
              <IconButton
                disabled={!props.entries.length}
                onClick={() => {
                  setSelected(undefined);
                  props.onClear();
                }}
              >
                <TrashIcon title="Clear timeline" />
              </IconButton>
            </div>
          </div>

          <div data-solid-timeline-body>
            <Show
              when={isTimelineAvailable()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>
                    The timeline needs a development build of solid-js.
                  </Text>
                </Placeholder>
              }
            >
              <div data-solid-timeline-list>
                <Show
                  when={shown().length}
                  fallback={
                    <Placeholder>
                      <Text options={{ size: 'xs' }}>
                        {props.entries.length
                          ? 'Nothing matches this filter.'
                          : 'Interact with the app to see what each action re-runs.'}
                      </Text>
                    </Placeholder>
                  }
                >
                  <For each={shown()}>
                    {(entry) => (
                      <button
                        type="button"
                        data-solid-timeline-row
                        data-kind={entry.origin ? 'interaction' : 'update'}
                        data-selected={selected() === entry.id ? '' : undefined}
                        onClick={() => select(entry.id)}
                      >
                        <span data-solid-timeline-row-head>
                          {outcomeBadge(entry)}
                          <Text
                            data-solid-timeline-row-label
                            options={{
                              size: 'xs',
                              weight: 'semibold',
                              font: 'mono',
                              wrap: 'nowrap',
                            }}
                          >
                            {entry.label}
                          </Text>
                        </span>
                        <Text data-solid-timeline-row-meta options={{ size: 'xs', font: 'mono' }}>
                          {[
                            plural(entry.writes.length, 'write'),
                            plural(runCount(entry), 're-run'),
                            ...(entry.calls.length ? [plural(entry.calls.length, 'call')] : []),
                            ms(duration(entry)),
                          ].join(' · ')}
                        </Text>
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <Show when={selectedEntry()}>
                {(entry) => (
                  <aside data-solid-timeline-detail>
                    <div data-solid-timeline-detail-head>
                      {outcomeBadge(entry())}
                      <Text options={{ size: 'sm', weight: 'semibold', font: 'mono' }}>
                        {entry().label}
                      </Text>
                      <CopyReportButton
                        label="this update"
                        report={() => timelineReport({ entry: entry(), route: pageRoute() })}
                      />
                    </div>

                    <Show when={entry().interaction}>
                      {(interaction) => (
                        <div data-solid-kv-table>
                          <Show when={interaction().inputDelayMs !== undefined}>
                            <div data-solid-kv-row>
                              <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                                Input delay
                              </Text>
                              <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                                {ms(interaction().inputDelayMs)}
                              </Text>
                            </div>
                          </Show>
                          <div data-solid-kv-row>
                            <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                              Handler
                            </Text>
                            <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                              {ms(interaction().handlerMs)}
                            </Text>
                          </div>
                          <div data-solid-kv-row>
                            <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                              Re-runs
                            </Text>
                            <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                              {`${interaction().runs}, ${ms(interaction().runMs)}`}
                            </Text>
                          </div>
                          <Show when={interaction().settledMs !== undefined}>
                            <div data-solid-kv-row>
                              <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                                Settled
                              </Text>
                              <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                                {`${ms(interaction().settledMs)} after the event`}
                              </Text>
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>

                    <Show when={entry().writes.length}>
                      <div data-solid-timeline-section>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Writes (${entry().writes.length})`}
                        </Text>
                        <For each={entry().writes}>
                          {(write) => (
                            <span data-solid-timeline-write>
                              <WriteText change={write} />
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div data-solid-timeline-section>
                      <Text options={{ size: 'xs', weight: 'semibold' }}>
                        {`Re-runs (${entry().runs.length + entry().droppedRuns})`}
                      </Text>
                      <For
                        each={entry().runs}
                        fallback={<Text options={{ size: 'xs' }}>Nothing re-ran.</Text>}
                      >
                        {(run) => (
                          <RunRow
                            run={run}
                            open={openRuns().includes(run.event.run)}
                            onToggle={() => toggleRun(run.event.run)}
                            onViewInGraph={props.onViewInGraph}
                          />
                        )}
                      </For>
                      <Show when={entry().droppedRuns}>
                        <Text data-solid-timeline-note options={{ size: 'xs' }}>
                          {`${entry().droppedRuns} more re-runs are not listed.`}
                        </Text>
                      </Show>
                      <Text data-solid-timeline-note options={{ size: 'xs' }}>
                        Open a re-run to see the changes that caused it.
                      </Text>
                    </div>

                    <Show when={entry().calls.length}>
                      <div data-solid-timeline-section>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Server calls (${entry().calls.length})`}
                        </Text>
                        <For each={entry().calls}>
                          {(call) => <CallRow call={call} onViewCall={props.onViewCall} />}
                        </For>
                      </div>
                    </Show>

                    <Show when={entry().holds.length}>
                      <div data-solid-timeline-section>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Holds (${entry().holds.length})`}
                        </Text>
                        <For each={entry().holds}>
                          {(hold) => (
                            <Text options={{ size: 'xs', font: 'mono' }}>
                              {`${ms(hold.holdMs)}${hold.blockers.length ? `, waiting on ${hold.blockers.join(', ')}` : ''}`}
                            </Text>
                          )}
                        </For>
                      </div>
                    </Show>
                  </aside>
                )}
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
