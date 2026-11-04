import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal, For, getOwner, Show } from 'solid-js';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { ResizeHandle } from '../../ui/ResizeHandle.js';
import { Text } from '../../ui/Text.js';
import { useResizableDetail } from '../../ui/use-resizable-detail.js';
import { CollapseIcon, EditIcon, ExpandIcon, EyeIcon, PauseIcon, PlayIcon } from '../icons.js';
import { openInEditor } from '../open-in-editor.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { pageRoute } from '../report/markdown.js';
import { ownerReport } from '../report/owner-report.js';
import { createDraftEdit } from '../reactivity/draft-edit.js';
import { DraftInput } from '../reactivity/DraftInput.js';
import { isTextEditable, writeReactiveValue } from '../reactivity/value-editor.js';
import { ValueInspector } from '../reactivity/ValueInspector.js';
import { previewValue, typeName } from './format.js';
import {
  excludeOwner,
  isOwnershipAvailable,
  ownerChainIds,
  snapshotOwnershipTree,
  startOwnershipTracking,
  subscribeOwnershipTree,
} from './registry.js';
import {
  ancestorsOf,
  EMPTY_TREE,
  type OwnerKind,
  type OwnershipTree,
  type TreeNode,
} from './tree.js';
import './styles.css';

/** Owners the reactivity graph draws. Components, roots and plain scopes hold no value. */
function isInGraph(kind: OwnerKind): boolean {
  return kind !== 'component' && kind !== 'root' && kind !== 'scope';
}

/** How long a row stays marked as new after it first appears. */
const FRESH_MS = 900;

interface Row {
  node: TreeNode;
  /** Depth in the visible tree, which differs from the owner depth when filtering. */
  indent: number;
  expandable: boolean;
  expanded: boolean;
}

export interface OwnershipViewerProps {
  show?: boolean;
  /** Opens a signal, memo or effect in the reactivity graph. */
  onViewInGraph?: (node: object) => void;
  /**
   * An owner another panel asked to show. Pass a new object for every request,
   * so asking for the same owner twice still moves the tree.
   */
  focus?: { owner: object };
}

interface OwnershipSignalRowProps {
  signal: { name: string; value: unknown; node: object };
  onViewInGraph?: (node: object) => void;
}

function OwnershipSignalRow(props: OwnershipSignalRowProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const edit = createDraftEdit({
    value: () => props.signal.value,
    write: (nextValue) => writeReactiveValue(props.signal.node, [], nextValue),
  });

  const isComplex = createMemo(
    () => typeof props.signal.value === 'object' && props.signal.value !== null,
  );
  // A Map, a Date or a class instance would come back from JSON as a plain
  // object, so only values that survive the round trip are edited as text.
  const textEditable = createMemo(() => isTextEditable(props.signal.value));

  function valueTitle(): string {
    if (edit.failed()) return 'The app did not take this edit';
    if (!textEditable()) return isComplex() ? 'Click to expand' : '';
    return isComplex() ? 'Click to expand / double-click to edit JSON' : 'Double-click to edit';
  }

  return (
    <div data-solid-ownership-signal-block>
      <div data-solid-ownership-signal>
        <span data-solid-ownership-signal-name>
          <Show when={isComplex()}>
            <button
              type="button"
              data-solid-ownership-signal-chevron
              data-expanded={expanded() ? 'true' : undefined}
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded() ? 'Collapse value' : 'Expand value'}
            />
          </Show>
          <Text
            options={{
              size: 'xs',
              weight: 'semibold',
              font: 'mono',
              wrap: 'nowrap',
            }}
          >
            {props.signal.name}
          </Text>
        </span>
        <Show
          when={edit.editing()}
          fallback={
            <>
              <Show
                when={typeof props.signal.value === 'boolean'}
                fallback={
                  <Text
                    data-solid-ownership-signal-value
                    data-solid-ownership-edit-failed={edit.failed() ? '' : undefined}
                    options={{ size: 'xs', font: 'mono' }}
                    onClick={() => {
                      if (isComplex()) setExpanded((v) => !v);
                    }}
                    onDblClick={() => {
                      if (textEditable()) edit.start();
                    }}
                    title={valueTitle()}
                  >
                    {previewValue(props.signal.value)}
                  </Text>
                }
              >
                <button
                  type="button"
                  data-solid-ownership-toggle-btn
                  data-value={props.signal.value ? 'true' : 'false'}
                  data-solid-ownership-edit-failed={edit.failed() ? '' : undefined}
                  onClick={() => edit.write(!props.signal.value)}
                  title={edit.failed() ? valueTitle() : 'Click to toggle boolean'}
                >
                  <Text options={{ size: 'xs', font: 'mono' }}>{`${props.signal.value}`}</Text>
                </button>
              </Show>
              <div data-solid-ownership-signal-actions>
                <Show when={textEditable()}>
                  <button
                    type="button"
                    data-solid-ownership-edit-signal
                    aria-label={`Edit ${props.signal.name}`}
                    title={`Edit ${props.signal.name}`}
                    onClick={edit.start}
                  >
                    <EditIcon title={`Edit ${props.signal.name}`} />
                  </button>
                </Show>
                <Show when={props.onViewInGraph}>
                  <button
                    type="button"
                    data-solid-ownership-view-graph
                    aria-label="View in graph"
                    onClick={() => props.onViewInGraph?.(props.signal.node)}
                  >
                    <EyeIcon title="View in graph" />
                  </button>
                </Show>
              </div>
            </>
          }
        >
          <DraftInput edit={edit} marker="data-solid-ownership-signal-input" />
        </Show>
      </div>
      <Show when={isComplex() && expanded()}>
        <div data-solid-ownership-signal-tree>
          <ValueInspector
            value={props.signal.value}
            open
            editable
            onEdit={(path, nextValue) => writeReactiveValue(props.signal.node, path, nextValue)}
          />
        </div>
      </Show>
    </div>
  );
}

export default function OwnershipViewer(props: OwnershipViewerProps): JSX.Element {
  // The panel renders inside the app it inspects, so its own scope is marked.
  excludeOwner(getOwner());

  const [tree, setTree] = createSignal<OwnershipTree>(EMPTY_TREE);
  const [componentsOnly, setComponentsOnly] = createSignal(true);
  const [paused, setPaused] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [collapsed, setCollapsed] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal<string>();
  const detail = useResizableDetail({ storageKey: 'solid-start-devtools:ownership-detail-width' });

  const firstSeen = new Map<string, number>();
  let appliedFocus: { owner: object } | undefined;
  let rowsElement: HTMLDivElement | undefined;

  // Takes the mode as an argument because reading a signal inside an effect
  // callback is not tracked.
  function refresh(mode: boolean): void {
    const next = snapshotOwnershipTree({ componentsOnly: mode });
    const now = Date.now();
    for (const node of next.nodes) {
      if (!firstSeen.has(node.id)) firstSeen.set(node.id, now);
    }
    // An unchanged fingerprint means the app tree did not move. Skipping the
    // write stops the panel's own render from feeding itself another update.
    setTree((current) => (current.fingerprint === next.fingerprint ? current : next));
  }

  createEffect(
    () => ({ watching: !!props.show && !paused(), mode: componentsOnly() }),
    (state) => {
      if (!state.watching) return;
      const read = () => refresh(state.mode);
      const stop = startOwnershipTracking();
      const unsubscribe = subscribeOwnershipTree(read);
      read();
      return () => {
        unsubscribe();
        stop();
      };
    },
  );

  // The graph can ask for an owner. The request selects the closest row the
  // tree shows for it, opens the rows above that row, and waits for a snapshot
  // that contains it.
  createEffect(
    () => ({ request: props.focus, nodes: tree().nodes, visible: !!props.show }),
    ({ request, nodes, visible }) => {
      if (!request || !visible || request === appliedFocus) return;
      const known = new Map(nodes.map((node) => [node.id, node]));
      const id = ownerChainIds(request.owner).find((candidate) => known.has(candidate));
      if (!id) return;
      appliedFocus = request;
      const open = new Set([id, ...ancestorsOf(known, id)]);
      setQuery('');
      setCollapsed((current) => current.filter((item) => !open.has(item)));
      setSelected(id);
      // The row exists after this flush renders, so scroll on the next frame.
      requestAnimationFrame(() => {
        rowsElement?.querySelector(`[data-owner-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      });
    },
  );
  const byId = createMemo(() => new Map(tree().nodes.map((node) => [node.id, node])));

  const matches = createMemo(() => {
    const search = query().trim().toLowerCase();
    if (!search) return undefined;
    const nodes = byId();
    const keep = new Set<string>();
    for (const node of tree().nodes) {
      const hit =
        node.name.toLowerCase().includes(search) ||
        node.kind.includes(search) ||
        node.signals.some(
          (signal) =>
            signal.name.toLowerCase().includes(search) ||
            previewValue(signal.value).toLowerCase().includes(search),
        ) ||
        node.scopes.some(
          (scope) =>
            scope.name.toLowerCase().includes(search) ||
            previewValue(scope.value).toLowerCase().includes(search),
        );
      if (!hit) continue;
      keep.add(node.id);
      for (const parent of ancestorsOf(nodes, node.id)) keep.add(parent);
    }
    return keep;
  });

  const rows = createMemo<Row[]>(() => {
    const nodes = byId();
    const visible = matches();
    const hidden = collapsed();
    const out: Row[] = [];

    const walk = (id: string, indent: number) => {
      const node = nodes.get(id);
      if (!node) return;
      if (visible && !visible.has(id)) return;
      const children = visible
        ? node.children.filter((child) => visible.has(child))
        : node.children;
      // A search result is always open, so matches deeper down stay reachable.
      const expanded = visible ? true : !hidden.includes(id);
      out.push({ node, indent, expandable: children.length > 0, expanded });
      if (!expanded) return;
      for (const child of children) walk(child, indent + 1);
    };

    for (const root of tree().roots) walk(root, 0);
    return out;
  });

  function toggle(id: string): void {
    setCollapsed((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function collapseAll(): void {
    setCollapsed(
      tree()
        .nodes.filter((node) => node.children.length > 0)
        .map((node) => node.id),
    );
  }

  const selectedNode = createMemo(() => {
    const id = selected();
    return id ? byId().get(id) : undefined;
  });

  const ancestry = createMemo<TreeNode[]>(() => {
    const id = selected();
    if (!id) return [];
    const nodes = byId();
    const current = nodes.get(id);
    if (!current) return [];
    const frames = [current];
    for (const parent of ancestorsOf(nodes, id)) {
      const owner = nodes.get(parent);
      if (owner) frames.push(owner);
    }
    return frames;
  });

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-ownership-viewer>
          <div data-solid-ownership-nav>
            <input
              data-solid-ownership-search
              type="search"
              placeholder="Filter by component, scope or signal"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <div data-solid-ownership-modes>
              <button
                type="button"
                data-solid-ownership-mode
                data-active={componentsOnly() ? '' : undefined}
                onClick={() => setComponentsOnly(true)}
              >
                <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>Components</Text>
              </button>
              <button
                type="button"
                data-solid-ownership-mode
                data-active={componentsOnly() ? undefined : ''}
                onClick={() => setComponentsOnly(false)}
              >
                <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>Owners</Text>
              </button>
            </div>
            <div data-solid-ownership-nav-actions>
              <Text data-solid-ownership-count options={{ size: 'xs', font: 'mono' }}>
                {`${rows().length} of ${tree().nodes.length}`}
              </Text>
              <IconButton onClick={() => setPaused((current) => !current)}>
                <Show
                  when={paused()}
                  fallback={<PauseIcon title="Pause live updates" />}
                  children={<PlayIcon title="Resume live updates" />}
                />
              </IconButton>
              <IconButton onClick={() => setCollapsed([])}>
                <ExpandIcon title="Expand all" />
              </IconButton>
              <IconButton onClick={collapseAll}>
                <CollapseIcon title="Collapse all" />
              </IconButton>
            </div>
          </div>

          <div data-solid-ownership-body>
            <Show
              when={isOwnershipAvailable()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>
                    The ownership tree needs a development build of solid-js.
                  </Text>
                </Placeholder>
              }
            >
              <div
                data-solid-ownership-rows
                ref={(element) => {
                  rowsElement = element;
                }}
              >
                <Show
                  when={rows().length > 0}
                  fallback={
                    <Placeholder>
                      <Text options={{ size: 'xs' }}>
                        {query() ? 'Nothing matches this filter.' : 'No owners observed yet.'}
                      </Text>
                    </Placeholder>
                  }
                >
                  <For each={rows()} keyed={(row) => row.node.id}>
                    {(row) => (
                      <div
                        data-solid-ownership-row
                        data-owner-id={row().node.id}
                        data-selected={selected() === row().node.id ? '' : undefined}
                        data-fresh={
                          Date.now() - (firstSeen.get(row().node.id) ?? 0) < FRESH_MS
                            ? ''
                            : undefined
                        }
                        style={{ 'padding-left': `${row().indent * 0.875 + 0.25}rem` }}
                      >
                        <button
                          type="button"
                          data-solid-ownership-chevron
                          data-leaf={row().expandable ? undefined : ''}
                          data-expanded={row().expanded ? '' : undefined}
                          aria-label={row().expanded ? 'Collapse' : 'Expand'}
                          onClick={() => row().expandable && toggle(row().node.id)}
                        />
                        <button
                          type="button"
                          data-solid-ownership-label
                          onClick={() =>
                            setSelected((current) =>
                              current === row().node.id ? undefined : row().node.id,
                            )
                          }
                        >
                          <span data-solid-ownership-kind={row().node.kind} />
                          <Text
                            data-solid-ownership-name
                            options={{
                              size: 'xs',
                              weight: 'semibold',
                              font: 'mono',
                              wrap: 'nowrap',
                            }}
                          >
                            {row().node.name}
                          </Text>
                          <Show when={row().node.disposed}>
                            <Badge type="failure">disposed</Badge>
                          </Show>
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              <Show when={selectedNode()}>
                {(node) => (
                  <aside data-solid-ownership-detail style={{ width: `${detail.width()}px` }}>
                    <ResizeHandle detail={detail} />
                    <div data-solid-ownership-detail-content>
                      <div data-solid-ownership-detail-head>
                        <span data-solid-ownership-kind={node().kind} />
                        <Text options={{ size: 'sm', weight: 'semibold', font: 'mono' }}>
                          {node().name}
                        </Text>
                        <Badge type="info">{node().kind}</Badge>
                        <Show when={props.onViewInGraph && isInGraph(node().kind)}>
                          <button
                            type="button"
                            data-solid-ownership-view-graph
                            aria-label="View in graph"
                            onClick={() => props.onViewInGraph?.(node().owner)}
                          >
                            <EyeIcon title="View in graph" />
                          </button>
                        </Show>
                        <CopyReportButton
                          label={`this ${node().kind}`}
                          report={() =>
                            ownerReport({
                              node: node(),
                              ancestry: ancestry(),
                              nodes: byId(),
                              route: pageRoute(),
                            })
                          }
                        />
                      </div>

                      <Show when={node().location}>
                        {(location) => (
                          <button
                            type="button"
                            data-solid-ownership-location
                            title="Open in editor"
                            onClick={() => openInEditor(location())}
                          >
                            <Text options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
                              {location()}
                            </Text>
                          </button>
                        )}
                      </Show>

                      <Show when={node().hasValue}>
                        <div data-solid-ownership-detail-block>
                          <Text options={{ size: 'xs', weight: 'semibold' }}>Value</Text>
                          <Text options={{ size: 'xs', font: 'mono' }}>
                            {`${previewValue(node().value)} (${typeName(node().value)})`}
                          </Text>
                        </div>
                      </Show>

                      <Show when={node().props}>
                        {(props) => (
                          <div data-solid-ownership-detail-block>
                            <Text options={{ size: 'xs', weight: 'semibold' }}>
                              {`Props (${props().length})`}
                            </Text>
                            <div data-solid-ownership-chips>
                              <For
                                each={props()}
                                fallback={
                                  <Text options={{ size: 'xs' }}>
                                    This component takes no props.
                                  </Text>
                                }
                              >
                                {(name) => (
                                  <span data-solid-ownership-chip>
                                    <Text options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
                                      {name}
                                    </Text>
                                  </span>
                                )}
                              </For>
                            </div>
                            <Text data-solid-ownership-note options={{ size: 'xs' }}>
                              Props are getters, so the panel lists their names without reading
                              them.
                            </Text>
                          </div>
                        )}
                      </Show>

                      <div data-solid-ownership-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Signals (${node().signals.length})`}
                        </Text>
                        <div data-solid-ownership-signals>
                          <For
                            each={node().signals}
                            fallback={
                              <Text options={{ size: 'xs' }}>This owner holds no signals.</Text>
                            }
                          >
                            {(signal) => (
                              <OwnershipSignalRow
                                signal={signal}
                                onViewInGraph={props.onViewInGraph}
                              />
                            )}
                          </For>
                        </div>
                      </div>

                      <Show when={node().scopes.length > 0}>
                        <div data-solid-ownership-detail-block>
                          <Text options={{ size: 'xs', weight: 'semibold' }}>
                            {`Scopes (${node().scopes.length})`}
                          </Text>
                          <div data-solid-ownership-signals>
                            <For each={node().scopes}>
                              {(scope) => (
                                <div data-solid-ownership-signal>
                                  <span data-solid-ownership-scope-name>
                                    <span data-solid-ownership-kind={scope.kind} />
                                    <Text
                                      options={{
                                        size: 'xs',
                                        weight: 'semibold',
                                        font: 'mono',
                                        wrap: 'nowrap',
                                      }}
                                    >
                                      {scope.name}
                                    </Text>
                                  </span>
                                  <Text
                                    data-solid-ownership-signal-value
                                    options={{ size: 'xs', font: 'mono' }}
                                  >
                                    {scope.hasValue ? previewValue(scope.value) : scope.kind}
                                  </Text>
                                  <Show when={props.onViewInGraph && isInGraph(scope.kind)}>
                                    <button
                                      type="button"
                                      data-solid-ownership-view-graph
                                      aria-label="View in graph"
                                      onClick={() => props.onViewInGraph?.(scope.node)}
                                    >
                                      <EyeIcon title="View in graph" />
                                    </button>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                          <Text data-solid-ownership-note options={{ size: 'xs' }}>
                            Memos and effects created inside this component, folded into it by
                            component mode.
                          </Text>
                        </div>
                      </Show>

                      <div data-solid-ownership-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Children (${node().children.length})`}
                        </Text>
                        <div data-solid-ownership-chips>
                          <For
                            each={node().children}
                            fallback={<Text options={{ size: 'xs' }}>Nothing below this one.</Text>}
                          >
                            {(id) => (
                              <Show when={byId().get(id)}>
                                {(child) => (
                                  <button
                                    type="button"
                                    data-solid-ownership-chip
                                    onClick={() => setSelected(id)}
                                  >
                                    <span data-solid-ownership-kind={child().kind} />
                                    <Text options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}>
                                      {child().name}
                                    </Text>
                                  </button>
                                )}
                              </Show>
                            )}
                          </For>
                        </div>
                      </div>

                      <div data-solid-ownership-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Ancestry (${ancestry().length})`}
                        </Text>
                        <div data-solid-ownership-stack>
                          <For each={ancestry()}>
                            {(frame, index) => (
                              <button
                                type="button"
                                data-solid-ownership-frame
                                data-current={index() === 0 ? '' : undefined}
                                onClick={() => setSelected(frame.id)}
                              >
                                <span data-solid-ownership-frame-index>{`${index()}`}</span>
                                <span data-solid-ownership-kind={frame.kind} />
                                <Text
                                  data-solid-ownership-frame-name
                                  options={{ size: 'xs', weight: 'semibold', font: 'mono' }}
                                >
                                  {frame.name}
                                </Text>
                                <Show when={frame.location}>
                                  {(location) => (
                                    <Text
                                      data-solid-ownership-frame-location
                                      options={{ size: 'xs', font: 'mono', wrap: 'nowrap' }}
                                    >
                                      {location()}
                                    </Text>
                                  )}
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                        <Text data-solid-ownership-note options={{ size: 'xs' }}>
                          The owners this one was created under, nearest first.
                        </Text>
                      </div>
                    </div>
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
