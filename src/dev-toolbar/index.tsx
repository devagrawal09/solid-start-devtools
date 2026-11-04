import type { JSX } from '@solidjs/web';
import { clientOnly, httpStatus, isServer, Portal } from '@solidjs/web';
import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  flush,
  For,
  getOwner,
  OBSERVE,
  onCleanup,
  onSettled,
  Show,
} from 'solid-js';
import version from '../version.js';
import IconButton from '../ui/IconButton.js';
import { type ServerFunctionInstance, ServerFunctionViewer } from './functions/index.js';
import { captureServerFunctionCall } from './functions/tracker.js';
import {
  AsyncIcon,
  ErrorIcon,
  FunctionIcon,
  GraphIcon,
  HighlightUpdatesIcon,
  InspectIcon,
  IssueIcon,
  MinimizeIcon,
  SolidIcon,
  TimelineIcon,
  TreeIcon,
} from './icons.js';
import { AsyncHistory, startAsyncCapture, type AsyncRecord } from './async/tracker.js';
import { HighlightUpdatesOverlay } from './highlight-updates/overlay.js';
import { installElementTracking, type InspectedComponent } from './inspector/lookup.js';
import { InspectorOverlay } from './inspector/overlay.js';
import { addIssues, captureIssues, type IssueEntry } from './issues/tracker.js';
import { isExtensionError } from './extension-errors.js';
import { openInEditor } from './open-in-editor.js';
import { CopyReportButton } from './report/CopyReportButton.js';
import { pageRoute } from './report/markdown.js';
import { excludeOwner, includeOwner } from './ownership/registry.js';
import { excludeReactiveOwner, includeReactiveOwner } from './reactivity/registry.js';
import { startTimeline, TimelineBuilder, type TimelineEntry } from './timeline/tracker.js';
import './index.css';

const ErrorViewer = clientOnly(() => import('./error-viewer/index.js'), { lazy: true });
const ReactivityViewer = clientOnly(() => import('./reactivity/index.js'), { lazy: true });
const OwnershipViewer = clientOnly(() => import('./ownership/index.js'), { lazy: true });
const IssuesViewer = clientOnly(() => import('./issues/index.js'), { lazy: true });
const TimelineViewer = clientOnly(() => import('./timeline/index.js'), { lazy: true });
const AsyncViewer = clientOnly(() => import('./async/index.js'), { lazy: true });

type Tab = 'err' | 'issues' | 'tl' | 'async' | 'fn' | 'rx' | 'own';

const TABS: { value: Tab; label: string; icon: typeof ErrorIcon }[] = [
  { value: 'err', label: 'Errors', icon: ErrorIcon },
  { value: 'issues', label: 'Issues', icon: IssueIcon },
  { value: 'tl', label: 'Timeline', icon: TimelineIcon },
  { value: 'async', label: 'Async', icon: AsyncIcon },
  { value: 'fn', label: 'Server functions', icon: FunctionIcon },
  { value: 'rx', label: 'Reactivity', icon: GraphIcon },
  { value: 'own', label: 'Ownership', icon: TreeIcon },
];

// The dock remembers whether it was open, its tab and its height, so a full
// reload during development comes back to the same view.
const STORAGE_KEY = 'solid-start-devtools:dock';
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 360;
// How far the pull tab moves up before a press becomes a drag that opens the dock.
const DRAG_THRESHOLD = 4;

interface DockState {
  open: boolean;
  tab: Tab;
  height: number;
  highlightUpdates?: boolean;
}

function readDockState(): Partial<DockState> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // Another script can write anything under the key.
    return value && typeof value === 'object' ? (value as Partial<DockState>) : {};
  } catch {
    // Storage can be blocked. The defaults stay.
    return {};
  }
}

function writeDockState(state: DockState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked.
  }
}

function clampHeight(height: number, max = window.innerHeight * 0.9): number {
  return Math.round(Math.min(Math.max(height, MIN_HEIGHT), max));
}

// The shortcut leaves typing alone, since Alt+Shift+D types a character on macOS.
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function currentRoute(): string {
  return location.pathname + location.search;
}

export interface DevToolbarProps {
  children?: JSX.Element;
}

/**
 * Owns the app the toolbar wraps. Everything created here counts as app code,
 * even though the toolbar's own scope encloses it.
 */
function AppScope(props: { children?: JSX.Element }): JSX.Element {
  const owner = getOwner();
  includeReactiveOwner(owner);
  includeOwner(owner);
  // The runtime's observe layer answers by the nearest marked ancestor: the
  // toolbar excluded its root above, so the app is handed back here.
  if (owner) OBSERVE?.include(owner);
  return <>{props.children}</>;
}

export function DevToolbar(props: DevToolbarProps) {
  // Everything the toolbar creates stays out of the graph and the tree it renders —
  // and out of the runtime's own observe layer (diagnostics, attribution, the
  // performance tracks), so the toolbar's signals and effects are never reported
  // as the app's.
  const owner = getOwner();
  excludeReactiveOwner(owner);
  excludeOwner(owner);
  if (owner) OBSERVE?.exclude(owner);

  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<Tab>('fn');
  const [height, setHeight] = createSignal(DEFAULT_HEIGHT);
  const [highlightUpdates, setHighlightUpdates] = createSignal(false);
  const [route, setRoute] = createSignal('');
  const [inspecting, setInspecting] = createSignal(false);
  const [selectedComponent, setSelectedComponent] = createSignal<InspectedComponent | undefined>();

  function toggleInspect() {
    setInspecting((current) => !current);
  }

  function selectComponent(comp: InspectedComponent) {
    setInspecting(false);
    setSelectedComponent(comp);
    setOwnershipFocus({ owner: comp.owner });
    if (!open()) {
      setOpen(true);
      persist({ open: true });
    }
  }

  function clearComponentFunnel() {
    setSelectedComponent(undefined);
  }

  // The dock keeps the height the user chose, and shows at most 90% of the
  // window, so a smaller window shrinks it without losing that choice.
  const [maxHeight, setMaxHeight] = createSignal(Infinity);
  const dockHeight = createMemo(() => clampHeight(height(), maxHeight()));

  let handle: HTMLButtonElement | undefined;
  let dock: HTMLDivElement | undefined;

  // Writes are batched, so a signal read right after its setter still returns
  // the old value. The caller passes what it just changed.
  function persist(next: Partial<DockState>) {
    writeDockState({
      open: open(),
      tab: tab(),
      height: height(),
      highlightUpdates: highlightUpdates(),
      ...next,
    });
  }

  function show(value: Tab) {
    setTab(value);
    setOpen(true);
    persist({ open: true, tab: value });
  }

  function close() {
    // The focused control hides with the dock, so focus moves to the handle.
    const hadFocus = !!dock?.contains(document.activeElement);
    setOpen(false);
    persist({ open: false });
    if (hadFocus) {
      flush();
      handle?.focus();
    }
  }

  // Opening from the handle or the shortcut moves focus to the selected tab. An
  // error opens the dock without moving focus.
  function openAndFocus() {
    show(tab());
    flush();
    dock?.querySelector<HTMLElement>(`[data-solid-dev-toolbar-tab="${tab()}"]`)?.focus();
  }

  // A panel is live only while the dock is open on its tab, so the graph and
  // the tree stop watching the app when nobody looks at them.
  const visible = (value: Tab) => open() && tab() === value;

  onSettled(() => {
    const saved = readDockState();
    if (TABS.some((entry) => entry.value === saved.tab)) setTab(saved.tab!);
    if (typeof saved.height === 'number') setHeight(clampHeight(saved.height));
    if (typeof saved.highlightUpdates === 'boolean') setHighlightUpdates(saved.highlightUpdates);
    if (saved.open) setOpen(true);

    const updateMaxHeight = () => setMaxHeight(window.innerHeight * 0.9);
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);

    // The Navigation API reports client-side navigations. Without it, only
    // history traversal updates the route.
    setRoute(currentRoute());
    const updateRoute = () => setRoute(currentRoute());
    const navigation = Reflect.get(window, 'navigation') as EventTarget | undefined;
    window.addEventListener('popstate', updateRoute);
    navigation?.addEventListener('currententrychange', updateRoute);
    return () => {
      window.removeEventListener('resize', updateMaxHeight);
      window.removeEventListener('popstate', updateRoute);
      navigation?.removeEventListener('currententrychange', updateRoute);
    };
  });

  // The page can scroll past the open dock. The dock's height is added to the
  // page's own padding, and the padding is put back only if nothing else
  // changed it meanwhile.
  createEffect(
    () => (open() ? dockHeight() : undefined),
    (value) => {
      if (value === undefined) return;
      const root = document.documentElement;
      const previous = root.style.paddingBottom;
      const own = parseFloat(getComputedStyle(root).paddingBottom) || 0;
      const next = `${own + value}px`;
      root.style.paddingBottom = next;
      return () => {
        if (root.style.paddingBottom === next) root.style.paddingBottom = previous;
      };
    },
  );

  // Dragging the top edge of the dock sets its height. Dragging the pull tab up
  // does the same once it passes the threshold, opening the dock under the
  // pointer. A press on the tab that never moves is left to its click.
  function onDragHeight(event: PointerEvent, opening: boolean) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = event.clientY;
    let dragging = !opening;
    let last = height();
    const move = (next: PointerEvent) => {
      if (!dragging) {
        if (start - next.clientY < DRAG_THRESHOLD) return;
        dragging = true;
        setOpen(true);
      }
      last = clampHeight(window.innerHeight - next.clientY);
      setHeight(last);
    };
    // The tab hides as the dock opens, so the pointer is followed on the window.
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (dragging) persist({ open: true, height: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  onSettled(() => {
    installElementTracking();
  });

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `code`, because Alt changes the character `key` reports on macOS.
      if (!event.altKey || !event.shiftKey) return;
      if (event.repeat || isEditable(event.composedPath()[0] ?? null)) return;

      if (event.code === 'KeyD') {
        event.preventDefault();
        if (open()) close();
        else openAndFocus();
      } else if (event.code === 'KeyH') {
        event.preventDefault();
        setHighlightUpdates((current) => {
          const next = !current;
          persist({ highlightUpdates: next });
          return next;
        });
      } else if (event.code === 'KeyC') {
        event.preventDefault();
        toggleInspect();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function onTabKeyDown(event: KeyboardEvent) {
    const index = TABS.findIndex((entry) => entry.value === tab());
    let target: number;
    if (event.key === 'ArrowDown') target = (index + 1) % TABS.length;
    else if (event.key === 'ArrowUp') target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = TABS.length - 1;
    else return;
    event.preventDefault();
    const next = TABS[target]!;
    show(next.value);
    const list = event.currentTarget as HTMLElement;
    list.querySelector<HTMLElement>(`[data-solid-dev-toolbar-tab="${next.value}"]`)?.focus();
  }

  // A panel can ask the graph to show a node. Each request is a new object, so
  // asking for the same node twice still moves the view.
  const [graphFocus, setGraphFocus] = createSignal<{ node: object }>();
  // The graph can ask the ownership tree to show an owner the same way.
  const [ownershipFocus, setOwnershipFocus] = createSignal<{ owner: object }>();
  // The timeline can ask the server-function panel to show a call.
  const [functionsFocus, setFunctionsFocus] = createSignal<{ instance: string }>();

  const [errors, setErrors] = createSignal<unknown[]>([]);

  function resetError() {
    setErrors([]);
  }

  function pushError(error: unknown) {
    console.error(error);
    setErrors((current) => [error, ...current]);

    show('err');
  }

  onSettled(() => {
    const onErrorEvent = (error: ErrorEvent) => {
      if (!error.error && error.message?.startsWith('ResizeObserver loop')) {
        return;
      }
      // A browser extension's script throws in the page too. It is not the app's.
      if (isExtensionError(error.error, error.filename)) return;
      pushError(error.error ?? error);
    };

    const onRejectionEvent = (event: PromiseRejectionEvent) => {
      if (isExtensionError(event.reason)) return;
      pushError(event.reason);
    };

    window.addEventListener('error', onErrorEvent);
    window.addEventListener('unhandledrejection', onRejectionEvent);

    return () => {
      window.removeEventListener('error', onErrorEvent);
      window.removeEventListener('unhandledrejection', onRejectionEvent);
    };
  });

  // Findings arrive while the app renders, before the toolbar settles, so the
  // channel is joined during setup instead of in `onSettled`.
  const [issues, setIssues] = createSignal<IssueEntry[]>([]);
  if (!isServer) {
    onCleanup(captureIssues((added) => setIssues((current) => addIssues(current, added))));
  }
  const issueCount = createMemo(() => issues().reduce((total, entry) => total + entry.count, 0));

  // The first action can come before the toolbar settles, so the timeline
  // starts during setup too.
  const timeline = new TimelineBuilder();
  const [timelineEntries, setTimelineEntries] = createSignal<TimelineEntry[]>([]);
  if (!isServer) {
    onCleanup(startTimeline(timeline, () => setTimelineEntries(timeline.snapshot())));
  }

  // Loads that finish before the toolbar settles are kept too.
  const asyncHistory = new AsyncHistory();
  const [asyncRecords, setAsyncRecords] = createSignal<AsyncRecord[]>([]);
  if (!isServer) {
    onCleanup(startAsyncCapture(asyncHistory, () => setAsyncRecords(asyncHistory.records)));
  }

  const [instances, setInstances] = createSignal<
    Record<string, ServerFunctionInstance | undefined>
  >({});

  onSettled(() =>
    captureServerFunctionCall((call) => {
      queueMicrotask(() => {
        setInstances((current) => ({
          ...current,
          [call.instance]:
            call.type === 'request'
              ? { ...current[call.instance], request: call }
              : ({ ...current[call.instance], response: call } as ServerFunctionInstance),
        }));
      });
    }),
  );

  const callCount = createMemo(() => Object.keys(instances()).length);

  async function copySession(): Promise<string> {
    // Loaded on use: mapping stacks needs the source-map reader the error panel loads lazily.
    const [{ resolveErrorFrames }, { SESSION_ERRORS, sessionReport }] = await Promise.all([
      import('./report/error-report.js'),
      import('./report/session-report.js'),
    ]);
    const recent = errors().slice(0, SESSION_ERRORS);
    const resolved = await Promise.all(
      recent.map(async (error) => ({ error, frames: await resolveErrorFrames(error) })),
    );
    return sessionReport({
      errors: resolved,
      errorCount: errors().length,
      issues: issues(),
      timeline: timelineEntries(),
      asyncRecords: asyncRecords(),
      calls: Object.values(instances()).filter((call) => call !== undefined),
      route: pageRoute(),
      version,
    });
  }

  const badge = (value: Tab): number => {
    if (value === 'err') return errors().length;
    if (value === 'issues') return issueCount();
    if (value === 'fn') return callCount();
    return 0;
  };

  return (
    <>
      <Portal>
        <div data-solid-dev-toolbar data-open={open() ? '' : undefined}>
          {/* The closed dock: a grip on the bottom edge that grows into a pull tab
              on hover or focus, so it covers almost none of the page. */}
          <button
            ref={handle}
            type="button"
            data-solid-dev-toolbar-handle
            data-errors={errors().length ? '' : undefined}
            aria-label={
              errors().length
                ? `Open Start Devtools, ${errors().length} errors`
                : 'Open Start Devtools'
            }
            title="Start Devtools (Alt+Shift+D)"
            hidden={open()}
            onPointerDown={(event) => onDragHeight(event, true)}
            onClick={openAndFocus}
          >
            <span data-solid-dev-toolbar-handle-grip />
            <span data-solid-dev-toolbar-handle-content>
              {/* The logo's SVG ids would clash with the header's copy, and a
                  hidden copy breaks the visible one, so only one renders. */}
              <Show when={!open()}>
                <SolidIcon title="" aria-hidden="true" />
              </Show>
              <span data-solid-dev-toolbar-version>{version}</span>
              <Show when={errors().length}>
                {(count) => <span data-solid-dev-toolbar-handle-errors>{count()}</span>}
              </Show>
              <MinimizeIcon title="" aria-hidden="true" data-solid-dev-toolbar-handle-chevron />
            </span>
          </button>
          <div
            ref={dock}
            data-solid-dev-toolbar-dock
            role="region"
            aria-label="Start Devtools"
            hidden={!open()}
            style={{ height: `${dockHeight()}px` }}
          >
            <div
              data-solid-dev-toolbar-resize
              title="Drag to resize"
              onPointerDown={(event) => onDragHeight(event, false)}
            />
            <div data-solid-dev-toolbar-header>
              <div data-solid-dev-toolbar-brand>
                <Show when={open()}>
                  <SolidIcon title="" aria-hidden="true" />
                </Show>
                <span>Start Devtools</span>
              </div>
              <span data-solid-dev-toolbar-version title="Start Devtools version">
                {version}
              </span>
              <span data-solid-dev-toolbar-route title="Current route">
                {route()}
              </span>
              <Show when={selectedComponent()}>
                {(comp) => (
                  <div data-solid-dev-toolbar-funnel>
                    <span data-solid-dev-toolbar-funnel-label>Inspecting</span>
                    <button
                      type="button"
                      data-solid-dev-toolbar-funnel-name
                      title={`View ${comp().name} in ownership tree`}
                      onClick={() => {
                        setOwnershipFocus({ owner: comp().owner });
                        show('own');
                      }}
                    >
                      {comp().name}
                    </button>
                    <Show when={comp().location}>
                      {(loc) => (
                        <button
                          type="button"
                          data-solid-dev-toolbar-funnel-action
                          title={`Open ${loc()} in editor`}
                          onClick={() => openInEditor(loc())}
                        >
                          Open in editor
                        </button>
                      )}
                    </Show>
                    <button
                      type="button"
                      data-solid-dev-toolbar-funnel-clear
                      title="Clear component funnel"
                      aria-label="Clear component funnel"
                      onClick={clearComponentFunnel}
                    >
                      ×
                    </button>
                  </div>
                )}
              </Show>
              <div data-solid-dev-toolbar-spacer />
              <IconButton
                onClick={toggleInspect}
                data-active={inspecting() ? '' : undefined}
                aria-label="Inspect element (Alt+Shift+C)"
                title="Inspect element (Alt+Shift+C)"
              >
                <InspectIcon title="Inspect element (Alt+Shift+C)" />
              </IconButton>
              <IconButton
                title="Highlight updates (Alt+Shift+H)"
                aria-label="Highlight updates (Alt+Shift+H)"
                aria-pressed={highlightUpdates() ? 'true' : 'false'}
                data-active={highlightUpdates() ? '' : undefined}
                onClick={() => {
                  setHighlightUpdates((current) => {
                    const next = !current;
                    persist({ highlightUpdates: next });
                    return next;
                  });
                }}
              >
                <HighlightUpdatesIcon title="Highlight updates (Alt+Shift+H)" />
              </IconButton>
              <CopyReportButton label="the whole session" report={copySession} />
              <IconButton onClick={close}>
                <MinimizeIcon title="Close Start Devtools" />
              </IconButton>
            </div>
            <div data-solid-dev-toolbar-main>
              <div
                data-solid-dev-toolbar-nav
                role="tablist"
                aria-orientation="vertical"
                onKeyDown={onTabKeyDown}
              >
                <For each={TABS}>
                  {(entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-label={entry.label}
                        // The label names the tab, so the count is read as its description.
                        aria-describedby={
                          badge(entry.value)
                            ? `solid-dev-toolbar-tab-${entry.value}-count`
                            : undefined
                        }
                        id={`solid-dev-toolbar-tab-${entry.value}`}
                        aria-controls="solid-dev-toolbar-body"
                        aria-selected={tab() === entry.value ? 'true' : 'false'}
                        tabindex={tab() === entry.value ? 0 : -1}
                        data-solid-dev-toolbar-tab={entry.value}
                        onClick={() => show(entry.value)}
                      >
                        <Icon title="" aria-hidden="true" />
                        <span data-solid-dev-toolbar-tab-label>{entry.label}</span>
                        <Show when={badge(entry.value)}>
                          {(count) => (
                            <span
                              id={`solid-dev-toolbar-tab-${entry.value}-count`}
                              data-solid-dev-toolbar-tab-badge={
                                entry.value === 'err'
                                  ? 'failure'
                                  : entry.value === 'issues'
                                    ? 'warning'
                                    : undefined
                              }
                            >
                              {count()}
                            </span>
                          )}
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
              <div
                data-solid-dev-toolbar-body
                id="solid-dev-toolbar-body"
                role="tabpanel"
                aria-labelledby={`solid-dev-toolbar-tab-${tab()}`}
              >
                <ErrorViewer show={visible('err')} errors={errors()} resetError={resetError} />
                <IssuesViewer
                  show={visible('issues')}
                  entries={issues()}
                  onClear={() => setIssues([])}
                  onViewOwner={(owner) => {
                    setOwnershipFocus({ owner });
                    show('own');
                  }}
                  onViewInGraph={(node) => {
                    setGraphFocus({ node });
                    show('rx');
                  }}
                />
                <TimelineViewer
                  show={visible('tl')}
                  entries={timelineEntries()}
                  onClear={() => {
                    timeline.clear();
                    setTimelineEntries([]);
                  }}
                  onViewCall={(instance) => {
                    setFunctionsFocus({ instance });
                    show('fn');
                  }}
                  onViewInGraph={(node) => {
                    setGraphFocus({ node });
                    show('rx');
                  }}
                />
                <AsyncViewer
                  show={visible('async')}
                  history={asyncHistory}
                  records={asyncRecords()}
                  onClear={() => {
                    asyncHistory.clear();
                    setAsyncRecords([]);
                  }}
                  onViewInGraph={(node) => {
                    setGraphFocus({ node });
                    show('rx');
                  }}
                  onViewOwner={(owner) => {
                    setOwnershipFocus({ owner });
                    show('own');
                  }}
                />
                <ReactivityViewer
                  show={visible('rx')}
                  focus={graphFocus()}
                  ownerFilter={selectedComponent()?.owner}
                  componentFilter={selectedComponent()?.name}
                  onViewOwner={(owner) => {
                    setOwnershipFocus({ owner });
                    show('own');
                  }}
                />
                <OwnershipViewer
                  show={visible('own')}
                  focus={ownershipFocus()}
                  onViewInGraph={(node) => {
                    setGraphFocus({ node });
                    show('rx');
                  }}
                />
                <ServerFunctionViewer
                  show={visible('fn')}
                  focus={functionsFocus()}
                  instances={instances()}
                  onDeleteInstance={(value) => {
                    setInstances((current) => {
                      const next = { ...current };
                      delete next[value];
                      return next;
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <HighlightUpdatesOverlay active={highlightUpdates()} />
        <InspectorOverlay
          active={inspecting()}
          onSelect={selectComponent}
          onCancel={() => setInspecting(false)}
        />
      </Portal>
      <Errored
        fallback={(error) => {
          const err = error();
          if (isServer) {
            // A server render is pure: it reports the failure and never
            // writes toolbar state. The client shows the error after hydration.
            httpStatus(500);
            console.error(err);
          } else {
            queueMicrotask(() => pushError(err));
          }
          return <></>;
        }}
      >
        <AppScope>{props.children}</AppScope>
      </Errored>
    </>
  );
}
