import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { Step, Timeline } from '../../time-travel/runtime.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { Text } from '../../ui/Text.js';
import { TrashIcon } from '../icons.js';
import { ValueInspector } from '../reactivity/ValueInspector.js';
import { stepLabel } from './source.js';
import './styles.css';

export interface HistoryViewerProps {
  show?: boolean;
  timeline: Timeline | undefined;
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((performance.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/**
 * The History panel: one row per drain that changed tracked state, newest
 * first, with the action or interaction behind it. Selecting a row shows the
 * app as it was right after that step; Resume returns to the present and
 * Branch here makes the shown step the present.
 */
export default function HistoryViewer(props: HistoryViewerProps): JSX.Element {
  const [selected, setSelected] = createSignal<number>();
  const steps = createMemo(() => (props.timeline?.steps() ?? []).slice().reverse());
  const cursor = () => props.timeline?.cursor() ?? -1;
  const traveling = () => props.timeline?.traveling() ?? false;
  const detail = createMemo<{ title: string; changes: Record<string, unknown> } | undefined>(() => {
    const id = selected();
    if (id === undefined || !props.timeline) return undefined;
    if (id === 0) return { title: 'Initial state', changes: props.timeline.initial() };
    const step = props.timeline.steps().find((entry) => entry.id === id);
    return step && { title: `Step ${step.id}: ${stepLabel(step)}`, changes: step.changes };
  });

  function view(id: number): void {
    setSelected(id);
    props.timeline?.goto(id);
  }

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-history-viewer>
          <div data-solid-history-nav>
            <Text data-solid-history-status options={{ size: 'xs', weight: 'semibold' }}>
              {traveling() ? `Viewing step ${cursor()}` : 'Live'}
            </Text>
            <Show when={traveling()}>
              <button
                type="button"
                data-solid-history-action
                onClick={() => {
                  props.timeline?.resume();
                  setSelected(undefined);
                }}
              >
                <Text options={{ size: 'xs', weight: 'semibold' }}>Resume</Text>
              </button>
              <button
                type="button"
                data-solid-history-action
                title="Make this step the present and drop the steps after it"
                onClick={() => props.timeline?.branch()}
              >
                <Text options={{ size: 'xs', weight: 'semibold' }}>Branch here</Text>
              </button>
            </Show>
            <div data-solid-history-nav-actions>
              <Text data-solid-history-count options={{ size: 'xs', font: 'mono' }}>
                {`${props.timeline?.steps().length ?? 0} steps`}
              </Text>
              <IconButton
                disabled={!props.timeline?.steps().length || traveling()}
                onClick={() => {
                  setSelected(undefined);
                  props.timeline?.clear();
                }}
              >
                <TrashIcon title="Clear history" />
              </IconButton>
            </div>
          </div>

          <div data-solid-history-body>
            <Show
              when={props.timeline}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>
                    Nothing is tracked. Create state with createTracked from
                    @solidjs/start-devtools/time-travel to record its history.
                  </Text>
                </Placeholder>
              }
            >
              {(timeline) => (
                <Show
                  when={timeline().supported() !== false}
                  fallback={
                    <Placeholder>
                      <Text options={{ size: 'xs' }}>
                        This version of solid-js does not report what each update changed, so there
                        is no history to show.
                      </Text>
                    </Placeholder>
                  }
                >
                  <div data-solid-history-list>
                    <For each={steps()}>
                      {(step: Step) => (
                        <button
                          type="button"
                          data-solid-history-row
                          data-current={cursor() === step.id ? '' : undefined}
                          data-selected={selected() === step.id ? '' : undefined}
                          onClick={() => view(step.id)}
                        >
                          <span data-solid-history-row-head>
                            <Text options={{ size: 'xs', font: 'mono' }}>{`#${step.id}`}</Text>
                            <Text
                              data-solid-history-row-label
                              options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}
                            >
                              {stepLabel(step)}
                            </Text>
                            <Text data-solid-history-row-time options={{ size: 'xs' }}>
                              {ago(step.at)}
                            </Text>
                          </span>
                          <Text
                            data-solid-history-row-changes
                            options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                          >
                            {Object.keys(step.changes).join(', ')}
                          </Text>
                        </button>
                      )}
                    </For>
                    <button
                      type="button"
                      data-solid-history-row
                      data-current={cursor() === 0 ? '' : undefined}
                      data-selected={selected() === 0 ? '' : undefined}
                      onClick={() => view(0)}
                    >
                      <span data-solid-history-row-head>
                        <Text options={{ size: 'xs', font: 'mono' }}>#0</Text>
                        <Text
                          data-solid-history-row-label
                          options={{ size: 'xs', weight: 'semibold' }}
                        >
                          Initial state
                        </Text>
                      </span>
                    </button>
                  </div>

                  <Show when={detail()}>
                    {(current) => (
                      <aside data-solid-history-detail>
                        <Text options={{ size: 'sm', weight: 'semibold' }}>{current().title}</Text>
                        <For each={Object.entries(current().changes)}>
                          {([name, value]) => (
                            <ValueInspector
                              value={value}
                              label={<Text options={{ size: 'xs', font: 'mono' }}>{name}</Text>}
                              open
                            />
                          )}
                        </For>
                      </aside>
                    )}
                  </Show>
                </Show>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
