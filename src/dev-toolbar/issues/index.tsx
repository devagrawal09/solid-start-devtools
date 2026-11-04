import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, DEV, For, Show } from 'solid-js';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { Text } from '../../ui/Text.js';
import { EyeIcon, TrashIcon, TreeIcon } from '../icons.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { pageRoute } from '../report/markdown.js';
import { issueReport } from '../report/issue-report.js';
import { isIssuesAvailable, issueText, type IssueEntry, type IssueEvent } from './tracker.js';
import './styles.css';

type Severity = IssueEvent['severity'];

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
];

const BADGES: Record<Severity, 'failure' | 'warning' | 'info'> = {
  error: 'failure',
  warn: 'warning',
  info: 'info',
};

/** The section of the repair guide for a code. Only dev builds of the runtime know it. */
function guideUrl(code: string): string | undefined {
  try {
    return DEV?.guideUrl(code as never);
  } catch {
    return undefined;
  }
}

/** A signal is not an owner, so the tree shows the owner it was created under. */
function ownerOf(subject: object): object {
  const node = subject as { _owner?: object; _parent?: object };
  return '_parent' in node || !node._owner ? subject : node._owner;
}

/** Computations and signals are in the graph. Components and roots are not. */
function isInGraph(subject: object): boolean {
  const node = subject as { _fn?: unknown; _parent?: unknown; _component?: unknown };
  if (node._component) return false;
  return typeof node._fn === 'function' || !('_parent' in node);
}

function dataText(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString();
}

export interface IssuesViewerProps {
  show?: boolean;
  entries: IssueEntry[];
  onClear: () => void;
  /** Opens the owner of a finding in the ownership tree. */
  onViewOwner?: (owner: object) => void;
  /** Opens the node of a finding in the reactivity graph. */
  onViewInGraph?: (node: object) => void;
}

export default function IssuesViewer(props: IssuesViewerProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [hidden, setHidden] = createSignal<Severity[]>([]);
  const [selected, setSelected] = createSignal<string>();

  const shown = createMemo(() => {
    const search = query().trim().toLowerCase();
    const off = hidden();
    return props.entries.filter((entry) => {
      if (off.includes(entry.event.severity)) return false;
      if (!search) return true;
      const { event } = entry;
      return [event.code, event.message, event.nodeName ?? '', ...(event.ownerPath ?? [])].some(
        (text) => text.toLowerCase().includes(search),
      );
    });
  });

  const selectedEntry = createMemo(() => {
    const key = selected();
    return key ? props.entries.find((entry) => entry.key === key) : undefined;
  });

  function toggleSeverity(value: Severity): void {
    setHidden((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-issues-viewer>
          <div data-solid-issues-nav>
            <input
              data-solid-issues-search
              type="search"
              placeholder="Filter by code, message or owner"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <div data-solid-issues-filters>
              <For each={SEVERITIES}>
                {(severity) => (
                  <button
                    type="button"
                    data-solid-issues-filter={severity.value}
                    data-off={hidden().includes(severity.value) ? '' : undefined}
                    aria-pressed={hidden().includes(severity.value) ? 'false' : 'true'}
                    onClick={() => toggleSeverity(severity.value)}
                  >
                    <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>
                      {severity.label}
                    </Text>
                  </button>
                )}
              </For>
            </div>
            <div data-solid-issues-nav-actions>
              <Text data-solid-issues-count options={{ size: 'xs', font: 'mono' }}>
                {`${shown().length} of ${props.entries.length}`}
              </Text>
              <IconButton
                disabled={!props.entries.length}
                onClick={() => {
                  setSelected(undefined);
                  props.onClear();
                }}
              >
                <TrashIcon title="Clear issues" />
              </IconButton>
            </div>
          </div>

          <div data-solid-issues-body>
            <Show
              when={isIssuesAvailable()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>Issues need a development build of solid-js.</Text>
                </Placeholder>
              }
            >
              <div data-solid-issues-list>
                <Show
                  when={shown().length}
                  fallback={
                    <Placeholder>
                      <Text options={{ size: 'xs' }}>
                        {props.entries.length
                          ? 'Nothing matches this filter.'
                          : 'No issues reported by the runtime.'}
                      </Text>
                    </Placeholder>
                  }
                >
                  <For each={shown()}>
                    {(entry) => (
                      <button
                        type="button"
                        data-solid-issues-row
                        data-severity={entry.event.severity}
                        data-selected={selected() === entry.key ? '' : undefined}
                        onClick={() =>
                          setSelected((current) => (current === entry.key ? undefined : entry.key))
                        }
                      >
                        <span data-solid-issues-row-head>
                          <Badge type={BADGES[entry.event.severity]}>{entry.event.code}</Badge>
                          <Show when={entry.count > 1}>
                            <span data-solid-issues-row-count>{`×${entry.count}`}</span>
                          </Show>
                          <Show when={entry.event.ownerPath?.length}>
                            <Text
                              data-solid-issues-row-owner
                              options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                            >
                              {entry.event.ownerPath!.join(' › ')}
                            </Text>
                          </Show>
                        </span>
                        <Text data-solid-issues-row-message options={{ size: 'xs' }}>
                          {issueText(entry.event)}
                        </Text>
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <Show when={selectedEntry()}>
                {(entry) => {
                  const subject = () => entry().subject?.deref();
                  const guide = () => guideUrl(entry().event.code);
                  return (
                    <aside data-solid-issues-detail>
                      <div data-solid-issues-detail-head>
                        <Badge type={BADGES[entry().event.severity]}>
                          {entry().event.severity}
                        </Badge>
                        <Text options={{ size: 'sm', weight: 'semibold', font: 'mono' }}>
                          {entry().event.code}
                        </Text>
                        <CopyReportButton
                          label="this issue"
                          report={() =>
                            issueReport({ entry: entry(), guideUrl: guide(), route: pageRoute() })
                          }
                        />
                      </div>

                      <Text data-solid-issues-detail-message options={{ size: 'xs' }}>
                        {issueText(entry().event)}
                      </Text>

                      <div data-solid-kv-table>
                        <div data-solid-kv-row>
                          <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                            Kind
                          </Text>
                          <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                            {entry().event.kind}
                          </Text>
                        </div>
                        <Show when={entry().event.ownerPath?.length}>
                          <div data-solid-kv-row>
                            <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                              Owner
                            </Text>
                            <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                              {entry().event.ownerPath!.join(' › ')}
                            </Text>
                          </div>
                        </Show>
                        <Show when={entry().event.nodeName}>
                          {(name) => (
                            <div data-solid-kv-row>
                              <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                                Node
                              </Text>
                              <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                                {name()}
                              </Text>
                            </div>
                          )}
                        </Show>
                        <div data-solid-kv-row>
                          <Text data-solid-kv-key options={{ size: 'xs', font: 'mono' }}>
                            Seen
                          </Text>
                          <Text data-solid-kv-value options={{ size: 'xs', font: 'mono' }}>
                            {entry().count > 1
                              ? `${entry().count} times, ${time(entry().firstAt)} to ${time(entry().lastAt)}`
                              : `once, ${time(entry().lastAt)}`}
                          </Text>
                        </div>
                      </div>

                      <div data-solid-issues-actions>
                        <Show when={props.onViewOwner && subject()}>
                          {(current) => (
                            <button
                              type="button"
                              data-solid-issues-action
                              onClick={() => props.onViewOwner?.(ownerOf(current()))}
                            >
                              <TreeIcon title="" aria-hidden="true" />
                              <Text options={{ size: 'xs', weight: 'semibold' }}>
                                Show in the ownership tree
                              </Text>
                            </button>
                          )}
                        </Show>
                        <Show
                          when={
                            props.onViewInGraph && subject() && isInGraph(subject()!) && subject()
                          }
                        >
                          {(current) => (
                            <button
                              type="button"
                              data-solid-issues-action
                              onClick={() => props.onViewInGraph?.(current())}
                            >
                              <EyeIcon title="" aria-hidden="true" />
                              <Text options={{ size: 'xs', weight: 'semibold' }}>
                                Show in the reactivity graph
                              </Text>
                            </button>
                          )}
                        </Show>
                        <Show when={guide()}>
                          {(url) => (
                            <a
                              data-solid-issues-action
                              href={url()}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Text options={{ size: 'xs', weight: 'semibold' }}>
                                Open the repair guide
                              </Text>
                            </a>
                          )}
                        </Show>
                      </div>

                      <Show when={entry().event.data && Object.keys(entry().event.data!).length}>
                        <div data-solid-issues-data>
                          <Text options={{ size: 'xs', weight: 'semibold' }}>Data</Text>
                          <pre>
                            <Text options={{ size: 'xs', font: 'mono' }}>
                              {dataText(entry().event.data!)}
                            </Text>
                          </pre>
                        </div>
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
