import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal, For, getOwner, Show } from 'solid-js';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { ResizeHandle } from '../../ui/ResizeHandle.js';
import { Text } from '../../ui/Text.js';
import { useResizableDetail } from '../../ui/use-resizable-detail.js';
import { FitIcon, PauseIcon, PlayIcon } from '../icons.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { pageRoute } from '../report/markdown.js';
import { reactiveReport } from '../report/reactive-report.js';
import { formatValue, typeName } from './format.js';
import {
  ARROW_SIZE,
  edgePath,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  placeHoverCard,
  type GraphLayout,
} from './layout.js';
import { ValueInspector } from './ValueInspector.js';
import { writeReactiveValue } from './value-editor.js';
import {
  EMPTY_GRAPH,
  excludeReactiveOwner,
  reactiveNodeId,
  isReactivityAvailable,
  snapshotReactivityGraph,
  startReactivityTracking,
  subscribeReactivityGraph,
  type ReactiveEdge,
  type ReactiveGraph,
  type ReactiveNode,
  type ReactiveNodeKind,
} from './registry.js';
import './styles.css';

const KINDS: { value: ReactiveNodeKind; label: string }[] = [
  { value: 'signal', label: 'Signals' },
  { value: 'memo', label: 'Memos' },
  { value: 'effect', label: 'Effects' },
  { value: 'render-effect', label: 'Render' },
];

const HOVER_CARD_WIDTH = 288;

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

function stateBadge(node: ReactiveNode): JSX.Element {
  if (node.errored) return <Badge type="failure">error</Badge>;
  if (node.pending) return <Badge type="warning">pending</Badge>;
  if (node.state === 'dirty') return <Badge type="warning">dirty</Badge>;
  if (node.state === 'check') return <Badge type="info">check</Badge>;
  if (node.uninitialized) return <Badge type="info">empty</Badge>;
  return <Badge type="success">clean</Badge>;
}

function ownerText(node: ReactiveNode): string {
  return node.ownerPath.length > 0 ? node.ownerPath.join(' › ') : 'unnamed owner';
}

function NodeSummary(props: {
  node: ReactiveNode;
  onOwner?: () => void;
  /** Adds a button that copies a report of the node. */
  onReport?: () => string;
}): JSX.Element {
  return (
    <>
      <div data-solid-reactivity-card-head>
        <span data-solid-reactivity-kind={props.node.kind} />
        <Text
          options={{
            size: 'xs',
            weight: 'semibold',
            font: 'mono',
            wrap: 'nowrap',
          }}
        >
          {props.node.name}
        </Text>
        {stateBadge(props.node)}
        <Show when={props.onReport}>
          {(report) => <CopyReportButton label={`this ${props.node.kind}`} report={report()} />}
        </Show>
      </div>
      <div data-solid-reactivity-card-row>
        <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>value</Text>
        <Text data-solid-reactivity-value options={{ size: 'xs', font: 'mono' }}>
          {formatValue(props.node.value)}
        </Text>
      </div>
      <div data-solid-reactivity-card-row>
        <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>type</Text>
        <Text options={{ size: 'xs', font: 'mono' }}>{typeName(props.node.value)}</Text>
      </div>
      <div data-solid-reactivity-card-row>
        <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>updates</Text>
        <Text options={{ size: 'xs', font: 'mono' }}>{`${props.node.updates}`}</Text>
      </div>
      <div data-solid-reactivity-card-row>
        <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>edges</Text>
        <Text options={{ size: 'xs', font: 'mono' }}>
          {`${props.node.sources.length} in / ${props.node.observers.length} out`}
        </Text>
      </div>
      <Show when={props.node.owner}>
        <div data-solid-reactivity-card-row>
          <Text options={{ size: 'xs', weight: 'semibold', wrap: 'nowrap' }}>owner</Text>
          <Show
            when={props.onOwner}
            fallback={<Text options={{ size: 'xs', font: 'mono' }}>{ownerText(props.node)}</Text>}
          >
            <button
              type="button"
              data-solid-reactivity-owner
              title="Show in the ownership tree"
              onClick={() => props.onOwner?.()}
            >
              <Text options={{ size: 'xs', font: 'mono' }}>{ownerText(props.node)}</Text>
            </button>
          </Show>
        </div>
      </Show>
    </>
  );
}

export interface ReactivityViewerProps {
  show?: boolean;
  /**
   * A node another panel asked to show. Pass a new object for every request,
   * so asking for the same node twice still moves the view.
   */
  focus?: { node: object };
  /** Opens the owner of a node in the ownership tree. */
  onViewOwner?: (owner: object) => void;
  /** Filters nodes to those owned by or under a specific component owner instance. */
  ownerFilter?: object;
  /** Filters nodes to those owned by or under a specific component name. */
  componentFilter?: string;
}

function isDescendantOf(owner: object | undefined, target: object): boolean {
  for (let cur = owner as Record<string, any> | null | undefined; cur; cur = cur._parent) {
    if (cur === target) return true;
  }
  return false;
}

export default function ReactivityViewer(props: ReactivityViewerProps): JSX.Element {
  // The panel watches the same runtime it renders in. Marking its owner keeps
  // the toolbar's own signals out of the graph.
  excludeReactiveOwner(getOwner());

  const [graph, setGraph] = createSignal<ReactiveGraph>(EMPTY_GRAPH);
  const [paused, setPaused] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [hiddenKinds, setHiddenKinds] = createSignal<ReactiveNodeKind[]>([]);
  const [selected, setSelected] = createSignal<string>();
  const [hovered, setHovered] = createSignal<string>();
  const [view, setView] = createSignal<ViewTransform>({ x: 0, y: 0, k: 1 });
  const detail = useResizableDetail({
    storageKey: 'solid-start-devtools:reactivity-detail-width',
    defaultWidth: 304,
  });

  let viewport: HTMLDivElement | undefined;
  let fittedSize = '';
  let moved = false;
  let appliedFocus: { node: object } | undefined;
  let centerFrame: number | undefined;

  function refresh(): void {
    const next = snapshotReactivityGraph();
    // Equal fingerprints mean the app graph did not move. Skipping the write
    // stops the panel's own render from feeding itself another update.
    setGraph((current) => (current.fingerprint === next.fingerprint ? current : next));
  }

  createEffect(
    () => !!props.show && !paused(),
    (watching) => {
      if (!watching) return;
      const stop = startReactivityTracking();
      const unsubscribe = subscribeReactivityGraph(refresh);
      refresh();
      return () => {
        unsubscribe();
        stop();
      };
    },
  );

  createEffect(
    () => !!props.show,
    (visible) => {
      if (!visible) {
        fittedSize = '';
        moved = false;
      }
    },
  );

  const visibleNodes = createMemo(() => {
    const search = query().trim().toLowerCase();
    const hidden = hiddenKinds();
    const ownerFilter = props.ownerFilter;
    const nameFilter = props.componentFilter?.replace(/^<|>$/g, '').trim().toLowerCase();
    return graph().nodes.filter((node) => {
      if (hidden.includes(node.kind)) return false;
      if (ownerFilter) {
        if (!isDescendantOf(node.owner, ownerFilter)) return false;
      } else if (
        nameFilter &&
        !node.ownerPath.some((p) => p.replace(/^<|>$/g, '').toLowerCase() === nameFilter)
      ) {
        return false;
      }
      if (!search) return true;
      return (
        node.name.toLowerCase().includes(search) ||
        node.kind.includes(search) ||
        formatValue(node.value).toLowerCase().includes(search) ||
        node.ownerPath.join(' ').toLowerCase().includes(search)
      );
    });
  });

  const visibleEdges = createMemo(() => {
    const ids = new Set(visibleNodes().map((node) => node.id));
    return graph().edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  });

  // Each layout is seeded with the one it replaces, so nodes keep their slot
  // as the graph grows instead of jumping around under the pointer.
  let lastLayout: GraphLayout | undefined;
  const layout = createMemo(() => {
    lastLayout = layoutGraph(
      visibleNodes().map((node) => ({
        id: node.id,
        name: node.name,
        kind: node.kind,
      })),
      visibleEdges(),
      lastLayout,
    );
    return lastLayout;
  });

  const nodesById = createMemo(() => new Map(visibleNodes().map((node) => [node.id, node])));

  const related = createMemo(() => {
    const id = selected();
    if (!id) return undefined;
    const edges = visibleEdges();
    const upstream = new Set<string>();
    const downstream = new Set<string>();

    const walk = (start: string, back: boolean, out: Set<string>) => {
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.pop()!;
        for (const edge of edges) {
          const next = back
            ? edge.to === current
              ? edge.from
              : null
            : edge.from === current
              ? edge.to
              : null;
          if (next && !out.has(next)) {
            out.add(next);
            queue.push(next);
          }
        }
      }
    };

    walk(id, true, upstream);
    walk(id, false, downstream);
    return { upstream, downstream };
  });

  function roleOf(id: string): string {
    const current = related();
    if (!current) return 'plain';
    if (id === selected()) return 'selected';
    if (current.upstream.has(id)) return 'upstream';
    if (current.downstream.has(id)) return 'downstream';
    return 'muted';
  }

  function edgeRoleOf(edge: ReactiveEdge): string {
    const current = related();
    if (!current) return 'plain';
    const from = roleOf(edge.from);
    const to = roleOf(edge.to);
    if (from === 'muted' || to === 'muted') return 'muted';
    if (from === 'upstream' || to === 'upstream') return 'upstream';
    if (from === 'downstream' || to === 'downstream') return 'downstream';
    return 'selected';
  }

  // Takes the layout as an argument so effects can pass the value they already
  // read. Reading a memo inside an effect callback is not tracked.
  function fit(current = layout()): void {
    const box = viewport?.getBoundingClientRect();
    if (!box || current.width === 0 || current.height === 0) return;
    // Shrinking past this makes the labels unreadable. Larger graphs are
    // meant to be panned instead.
    const k = Math.max(
      0.55,
      Math.min(1, (box.width - 16) / current.width, (box.height - 16) / current.height),
    );
    setView({
      k,
      x: (box.width - current.width * k) / 2,
      y: (box.height - current.height * k) / 2,
    });
  }

  /** Moves the view so a node sits in the middle. False when the canvas is not there yet. */
  function centerOn(position: { x: number; y: number }): boolean {
    const box = viewport?.getBoundingClientRect();
    if (!box || box.width === 0) return false;
    moved = true;
    setView((current) => ({
      k: current.k,
      x: box.width / 2 - (position.x + NODE_WIDTH / 2) * current.k,
      y: box.height / 2 - (position.y + NODE_HEIGHT / 2) * current.k,
    }));
    return true;
  }

  /**
   * Centers a node on the next frame. Selecting a node mounts the detail pane,
   * which narrows the canvas, so measuring right away would center against the
   * old width. A few frames are allowed for the layout to include the node.
   */
  function centerSoon(id: string, attempts = 5): void {
    if (centerFrame !== undefined) cancelAnimationFrame(centerFrame);
    centerFrame = requestAnimationFrame(() => {
      centerFrame = undefined;
      const position = lastLayout?.nodes.get(id);
      if (position && centerOn(position)) return;
      if (attempts > 1) centerSoon(id, attempts - 1);
    });
  }

  // Another panel can ask for a node. Filters that would hide it are cleared,
  // and the request waits for a snapshot that contains the node.
  createEffect(
    () => ({
      request: props.focus,
      nodes: graph().nodes,
      visible: !!props.show,
    }),
    ({ request, nodes, visible }) => {
      if (!request || !visible || request === appliedFocus) return;
      const id = reactiveNodeId(request.node);
      const target = nodes.find((node) => node.id === id);
      if (!target) return;
      appliedFocus = request;
      setQuery('');
      setHiddenKinds((current) => current.filter((kind) => kind !== target.kind));
      setSelected(id);
      // Keeps the auto fit from taking the view back before the frame runs.
      moved = true;
      centerSoon(id);
    },
  );

  // Refit while the graph grows. Once the user pans or zooms, the view is
  // theirs and only the fit button moves it.
  createEffect(
    () => layout(),
    (current) => {
      const size = `${current.width}x${current.height}`;
      if (moved || current.width === 0 || size === fittedSize) return;
      fittedSize = size;
      fit(current);
    },
  );

  function onWheel(event: WheelEvent): void {
    if (!viewport) return;
    event.preventDefault();
    moved = true;
    const box = viewport.getBoundingClientRect();
    const pointerX = event.clientX - box.left;
    const pointerY = event.clientY - box.top;
    setView((current) => {
      const k = Math.min(2.5, Math.max(0.2, current.k * Math.exp(-event.deltaY / 400)));
      const ratio = k / current.k;
      return {
        k,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  }

  function onPanStart(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-solid-reactivity-node]')) return;
    const origin = view();
    const startX = event.clientX;
    const startY = event.clientY;
    const surface = event.currentTarget as HTMLElement;
    moved = true;
    surface.setPointerCapture(event.pointerId);
    surface.dataset.panning = '';

    const move = (moved: PointerEvent) => {
      setView({
        k: origin.k,
        x: origin.x + (moved.clientX - startX),
        y: origin.y + (moved.clientY - startY),
      });
    };
    const end = () => {
      surface.releasePointerCapture(event.pointerId);
      delete surface.dataset.panning;
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', end);
    };

    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  function toggleKind(kind: ReactiveNodeKind): void {
    setHiddenKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  }

  let hoverCardElement: HTMLDivElement | undefined;
  // Measured after each render, so the next placement knows how tall the card is.
  let hoverCardHeight = 160;

  const hoverCard = createMemo(() => {
    const id = hovered();
    if (!id || id === selected()) return undefined;
    const node = nodesById().get(id);
    const position = layout().nodes.get(id);
    if (!node || !position) return undefined;
    const current = view();
    const placement = placeHoverCard({
      node: {
        left: current.x + position.x * current.k,
        top: current.y + position.y * current.k,
        width: NODE_WIDTH * current.k,
        height: NODE_HEIGHT * current.k,
      },
      canvas: {
        width: viewport?.clientWidth ?? 0,
        height: viewport?.clientHeight ?? 0,
      },
      card: { width: HOVER_CARD_WIDTH, height: hoverCardHeight },
    });
    return { node, placement };
  });

  createEffect(
    () => hoverCard(),
    () => {
      if (hoverCardElement) hoverCardHeight = hoverCardElement.offsetHeight;
    },
  );

  const selectedNode = createMemo(() => {
    const id = selected();
    return id ? nodesById().get(id) : undefined;
  });

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-reactivity-viewer>
          <div data-solid-reactivity-nav>
            <input
              data-solid-reactivity-search
              type="search"
              placeholder="Filter by name, value or owner"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <div data-solid-reactivity-filters>
              <For each={KINDS}>
                {(kind) => (
                  <button
                    type="button"
                    data-solid-reactivity-filter={kind.value}
                    data-off={hiddenKinds().includes(kind.value) ? '' : undefined}
                    onClick={() => toggleKind(kind.value)}
                  >
                    <Text
                      options={{
                        size: 'xs',
                        weight: 'semibold',
                        wrap: 'nowrap',
                      }}
                    >
                      {kind.label}
                    </Text>
                  </button>
                )}
              </For>
            </div>
            <div data-solid-reactivity-nav-actions>
              <Text data-solid-reactivity-count options={{ size: 'xs', font: 'mono' }}>
                {`${visibleNodes().length} nodes / ${visibleEdges().length} edges`}
              </Text>
              <IconButton onClick={() => setPaused((current) => !current)}>
                <Show
                  when={paused()}
                  fallback={<PauseIcon title="Pause live updates" />}
                  children={<PlayIcon title="Resume live updates" />}
                />
              </IconButton>
              <IconButton
                onClick={() => {
                  moved = false;
                  fit();
                }}
              >
                <FitIcon title="Fit graph to view" />
              </IconButton>
            </div>
          </div>

          <div data-solid-reactivity-body>
            <Show
              when={isReactivityAvailable()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>
                    The reactivity graph needs a development build of solid-js.
                  </Text>
                </Placeholder>
              }
            >
              <div
                data-solid-reactivity-canvas
                ref={(element) => {
                  viewport = element;
                }}
                onWheel={onWheel}
                onPointerDown={onPanStart}
              >
                <Show
                  when={visibleNodes().length > 0}
                  fallback={
                    <Placeholder>
                      <Text options={{ size: 'xs' }}>
                        No observed signals yet. Interact with the app and they appear here.
                      </Text>
                    </Placeholder>
                  }
                >
                  <div
                    data-solid-reactivity-surface
                    style={{
                      transform: `translate(${view().x}px, ${view().y}px) scale(${view().k})`,
                      width: `${layout().width}px`,
                      height: `${layout().height}px`,
                    }}
                  >
                    <svg
                      data-solid-reactivity-edges
                      width={layout().width}
                      height={layout().height}
                      viewBox={`0 0 ${layout().width} ${layout().height}`}
                    >
                      <defs>
                        <marker
                          id="solid-reactivity-arrow"
                          viewBox="0 0 10 10"
                          refX="0"
                          refY="5"
                          markerUnits="userSpaceOnUse"
                          markerWidth={ARROW_SIZE}
                          markerHeight={ARROW_SIZE}
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                        </marker>
                        <marker
                          id="solid-reactivity-arrow-active"
                          viewBox="0 0 10 10"
                          refX="2"
                          refY="5"
                          markerUnits="userSpaceOnUse"
                          markerWidth={ARROW_SIZE + 2}
                          markerHeight={ARROW_SIZE + 2}
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                        </marker>
                      </defs>
                      <For each={visibleEdges()} keyed={(edge) => `${edge.from}>${edge.to}`}>
                        {(edge) => {
                          const role = () => edgeRoleOf(edge());
                          return (
                            <Show when={layout().nodes.get(edge().from)}>
                              {(from) => (
                                <Show when={layout().nodes.get(edge().to)}>
                                  {(to) => (
                                    <path
                                      data-solid-reactivity-edge={role()}
                                      d={edgePath(from(), to())}
                                      marker-end={
                                        role() === 'plain' || role() === 'muted'
                                          ? 'url(#solid-reactivity-arrow)'
                                          : 'url(#solid-reactivity-arrow-active)'
                                      }
                                    />
                                  )}
                                </Show>
                              )}
                            </Show>
                          );
                        }}
                      </For>
                    </svg>

                    <For each={visibleNodes()} keyed={(node) => node.id}>
                      {(node) => (
                        <Show when={layout().nodes.get(node().id)}>
                          {(position) => (
                            <button
                              type="button"
                              data-solid-reactivity-node={roleOf(node().id)}
                              data-kind={node().kind}
                              data-state={node().state}
                              data-pending={node().pending ? '' : undefined}
                              data-errored={node().errored ? '' : undefined}
                              data-fresh={Date.now() - node().updatedAt < 700 ? '' : undefined}
                              style={{
                                transform: `translate(${position().x}px, ${position().y}px)`,
                                width: `${NODE_WIDTH}px`,
                                height: `${NODE_HEIGHT}px`,
                              }}
                              onPointerEnter={() => setHovered(node().id)}
                              onPointerLeave={() =>
                                setHovered((current) =>
                                  current === node().id ? undefined : current,
                                )
                              }
                              onClick={() =>
                                setSelected((current) =>
                                  current === node().id ? undefined : node().id,
                                )
                              }
                            >
                              <span data-solid-reactivity-node-name>{node().name}</span>
                              <span data-solid-reactivity-node-value>
                                {formatValue(node().value)}
                              </span>
                              <Show when={node().updates > 0}>
                                <span data-solid-reactivity-node-updates>{node().updates}</span>
                              </Show>
                            </button>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={hoverCard()}>
                  {(card) => (
                    <div
                      data-solid-reactivity-hovercard
                      data-placement={card().placement.side}
                      ref={(element) => {
                        hoverCardElement = element;
                      }}
                      style={{
                        left: `${card().placement.left}px`,
                        top: `${card().placement.y}px`,
                        '--start-dt-caret-x': `${card().placement.caret}px`,
                      }}
                    >
                      <NodeSummary node={card().node} />
                    </div>
                  )}
                </Show>

                <Show when={graph().dropped > 0}>
                  <div data-solid-reactivity-notice>
                    <Text options={{ size: 'xs' }}>
                      {`${graph().dropped} more nodes are not shown. Filter to narrow the graph.`}
                    </Text>
                  </div>
                </Show>
              </div>

              <Show when={selectedNode()}>
                {(node) => (
                  <aside data-solid-reactivity-detail style={{ width: `${detail.width()}px` }}>
                    <ResizeHandle detail={detail} />
                    <div data-solid-reactivity-detail-content>
                      <NodeSummary
                        node={node()}
                        onReport={() =>
                          reactiveReport({
                            node: node(),
                            // Every node, so a source the filter hides is still named.
                            nodes: new Map(graph().nodes.map((item) => [item.id, item])),
                            route: pageRoute(),
                          })
                        }
                        onOwner={
                          props.onViewOwner
                            ? () => {
                                // A signal lives inside its owner. A memo or effect is an
                                // owner itself, so the tree can show it directly.
                                const current = node();
                                const anchor =
                                  current.kind === 'signal' || current.kind === 'store'
                                    ? current.owner
                                    : current.raw;
                                if (anchor) props.onViewOwner?.(anchor);
                              }
                            : undefined
                        }
                      />
                      <div data-solid-reactivity-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {node().errored ? 'Error' : 'Value'}
                        </Text>
                        <div data-solid-reactivity-detail-value>
                          <ValueInspector
                            value={node().errored ? node().error : node().value}
                            open
                            editable={
                              !node().errored &&
                              (node().kind === 'signal' || node().kind === 'store')
                            }
                            onEdit={(path, nextValue) =>
                              writeReactiveValue(node().raw, path, nextValue)
                            }
                          />
                        </div>
                      </div>
                      <div data-solid-reactivity-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Sources (${node().sources.length})`}
                        </Text>
                        <div data-solid-reactivity-links>
                          <For
                            each={node().sources}
                            fallback={
                              <Text options={{ size: 'xs' }}>Nothing feeds this node.</Text>
                            }
                          >
                            {(id) => (
                              <Show when={nodesById().get(id)}>
                                {(source) => (
                                  <button
                                    type="button"
                                    data-solid-reactivity-link
                                    onClick={() => setSelected(id)}
                                  >
                                    <span data-solid-reactivity-kind={source().kind} />
                                    <Text
                                      options={{
                                        size: 'xs',
                                        font: 'mono',
                                        wrap: 'nowrap',
                                      }}
                                    >
                                      {source().name}
                                    </Text>
                                  </button>
                                )}
                              </Show>
                            )}
                          </For>
                        </div>
                      </div>
                      <div data-solid-reactivity-detail-block>
                        <Text options={{ size: 'xs', weight: 'semibold' }}>
                          {`Observers (${node().observers.length})`}
                        </Text>
                        <div data-solid-reactivity-links>
                          <For
                            each={node().observers}
                            fallback={
                              <Text options={{ size: 'xs' }}>Nothing depends on this node.</Text>
                            }
                          >
                            {(id) => (
                              <Show when={nodesById().get(id)}>
                                {(observer) => (
                                  <button
                                    type="button"
                                    data-solid-reactivity-link
                                    onClick={() => setSelected(id)}
                                  >
                                    <span data-solid-reactivity-kind={observer().kind} />
                                    <Text
                                      options={{
                                        size: 'xs',
                                        font: 'mono',
                                        wrap: 'nowrap',
                                      }}
                                    >
                                      {observer().name}
                                    </Text>
                                  </button>
                                )}
                              </Show>
                            )}
                          </For>
                        </div>
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
