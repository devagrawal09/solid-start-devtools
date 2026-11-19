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
import type { ServerFunctionInstance } from './functions/index.js';
import { captureServerFunctionCall } from './functions/tracker.js';
import { HighlightUpdatesIcon, InspectIcon, MinimizeIcon, SolidIcon } from './icons.js';
import { AsyncHistory, startAsyncCapture, type AsyncRecord } from './async/tracker.js';
import { HighlightUpdatesOverlay } from './highlight-updates/overlay.js';
import { installElementTracking, type InspectedComponent } from './inspector/lookup.js';
import { InspectorOverlay } from './inspector/overlay.js';
import { addIssues, captureIssues, type IssueEntry } from './issues/tracker.js';
import { isExtensionError } from './extension-errors.js';
import { CopyReportButton } from './report/CopyReportButton.js';
import { pageRoute } from './report/markdown.js';
import {
  addPageError,
  addServerError,
  createErrorRecord,
  createServerErrorRecord,
  type ErrorRecord,
} from './error-record.js';
import { listenToDevServer } from './dev-server.js';
import { excludeOwner, includeOwner } from './ownership/registry.js';
import { excludeReactiveOwner, includeReactiveOwner } from './reactivity/registry.js';
import { startTimeline, TimelineBuilder, type TimelineEntry } from './timeline/tracker.js';
import type { PaletteTarget } from './palette/search.js';
import { SignalHistory } from './structure/signal-history.js';
import './index.css';

const HealthViewer = clientOnly(() => import('./health/index.js'), { lazy: true });
const ActivityViewer = clientOnly(() => import('./activity/index.js'), { lazy: true });
const StructureViewer = clientOnly(() => import('./structure/index.js'), { lazy: true });
const CommandPalette = clientOnly(() => import('./palette/index.js'), { lazy: true });

/** A view of the dock. */
type Tab = 'health' | 'activity' | 'structure';
type StructureMode = 'owners' | 'graph';

const VIEWS: { value: Tab; label: string }[] = [
  { value: 'health', label: 'Health' },
  { value: 'activity', label: 'Activity' },
  { value: 'structure', label: 'Structure' },
];

/** The panels of older versions, and the view each now lives in. */
const OLD_TABS: Record<string, Tab> = {
  err: 'health',
  issues: 'health',
  tl: 'activity',
  async: 'activity',
  fn: 'activity',
  own: 'structure',
  rx: 'structure',
};

/** Reads a saved tab, mapping the panels of older versions to their view. */
function savedTab(value: unknown): Tab | undefined {
  if (typeof value !== 'string') return undefined;
  if (value in OLD_TABS) return OLD_TABS[value];
  for (const view of VIEWS) {
    if (view.value === value) return view.value;
  }
  return undefined;
}

/** The solid-js version the app runs, read from its package once the toolbar loads. */
async function loadSolidVersion(): Promise<string | undefined> {
  try {
    // No import attribute: Vite serves the file as a module, and a browser
    // rejects that module when the import asks for JSON.
    const pkg = await import('solid-js/package.json');
    return (pkg.default as { version?: string }).version;
  } catch {
    // A bundler that cannot import the package file leaves the version out.
    return undefined;
  }
}

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
  structureMode?: StructureMode;
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

/**
 * Writes a panel's list only when the tracker has a new one. The trackers run on
 * every flush record, and the toolbar's own write can be held by a pending action
 * the same way an app write is. Writing the same list back to a held signal still
 * schedules a flush, whose record called the tracker again, so the tab never
 * went idle (solidjs/solid#5038).
 */
function writeWhenChanged<T>(read: () => T, write: (value: T) => unknown): () => void {
  let written: T | undefined;
  return () => {
    const next = read();
    if (next === written) return;
    written = next;
    write(next);
  };
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

/** The solid-js version chip, in the pull tab and the header. */
function SolidVersion(props: { value: string }): JSX.Element {
  return (
    <span data-solid-dev-toolbar-version title="solid-js version">
      solid-js <b>{props.value}</b>
    </span>
  );
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
  const [tab, setTab] = createSignal<Tab>('activity');
  const [structureMode, setStructureMode] = createSignal<StructureMode>('owners');
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [solidVersion, setSolidVersion] = createSignal<string>();
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
    // The pick opens in the ownership tree, which selects and shows it.
    setOwnershipFocus({ owner: comp.owner });
    showOwner(comp.owner);
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
      structureMode: structureMode(),
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

  function changeStructureMode(mode: StructureMode) {
    setStructureMode(mode);
    persist({ structureMode: mode });
  }

  // Other views link into Structure: an owner opens the tree, a node the graph.
  function showOwner(owner: object) {
    setOwnershipFocus({ owner });
    changeStructureMode('owners');
    show('structure');
  }

  function showInGraph(node: object) {
    setGraphFocus({ node });
    changeStructureMode('graph');
    show('structure');
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
    dock?.querySelector<HTMLElement>(`[data-solid-dev-toolbar-view="${tab()}"]`)?.focus();
  }

  // A panel is live only while the dock is open on its tab, so the graph and
  // the tree stop watching the app when nobody looks at them.
  const visible = (value: Tab) => open() && tab() === value;

  onSettled(() => {
    const saved = readDockState();
    const restored = savedTab(saved.tab);
    if (restored) setTab(restored);
    if (saved.structureMode === 'owners' || saved.structureMode === 'graph') {
      setStructureMode(saved.structureMode);
    }
    void loadSolidVersion().then((value) => {
      // The dev server's answer can come first, and it reads the same package.
      if (value) setSolidVersion(value);
    });
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
      // ⌘K or Ctrl+K opens the palette, only while the dock is open so the
      // app keeps the shortcut otherwise.
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyK' && open()) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }
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

  // Arrow keys move along a tab list, and Home and End jump to its ends.
  function nextIndex(event: KeyboardEvent, index: number, length: number): number | undefined {
    if (event.key === 'ArrowRight') return (index + 1) % length;
    if (event.key === 'ArrowLeft') return (index - 1 + length) % length;
    if (event.key === 'Home') return 0;
    if (event.key === 'End') return length - 1;
    return undefined;
  }

  function onViewKeyDown(event: KeyboardEvent) {
    const index = VIEWS.findIndex((entry) => entry.value === tab());
    const target = nextIndex(event, index, VIEWS.length);
    if (target === undefined) return;
    event.preventDefault();
    const next = VIEWS[target]!;
    show(next.value);
    const list = event.currentTarget as HTMLElement;
    list.querySelector<HTMLElement>(`[data-solid-dev-toolbar-view="${next.value}"]`)?.focus();
  }

  // A panel can ask the graph to show a node. Each request is a new object, so
  // asking for the same node twice still moves the view.
  const [graphFocus, setGraphFocus] = createSignal<{ node: object }>();
  // The graph can ask the ownership tree to show an owner the same way.
  const [ownershipFocus, setOwnershipFocus] = createSignal<{ owner: object }>();
  // Health, Structure and the palette can ask Activity to show an action, a call or an owner.
  const [activityFocus, setActivityFocus] = createSignal<{
    origin?: object;
    instance?: string;
    ownerName?: string;
  }>();

  function showInActivity(focus: { origin?: object; instance?: string; ownerName?: string }) {
    setActivityFocus(focus);
    show('activity');
  }

  // The structure view shows the last change of a signal it lists.
  const signalHistory = new SignalHistory();

  const [errors, setErrors] = createSignal<ErrorRecord[]>([]);

  function resetError() {
    setErrors([]);
  }

  function pushError(error: unknown) {
    console.error(error);
    const record = createErrorRecord(error);
    setErrors((current) => addPageError(current, record));

    show('health');
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

    // Errors the server runtime reported, when @solidjs/vite-plugin connected the toolbar.
    const stopDevServer = listenToDevServer({
      onInfo(info) {
        const fromServer = info.versions['solid-js'];
        if (fromServer && !solidVersion()) setSolidVersion(fromServer);
      },
      onServerError(message) {
        // The dev server already printed it to its terminal.
        setErrors((current) => addServerError(current, createServerErrorRecord(message)));
        show('health');
      },
    });

    return () => {
      window.removeEventListener('error', onErrorEvent);
      window.removeEventListener('unhandledrejection', onRejectionEvent);
      stopDevServer();
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
    onCleanup(
      startTimeline(
        timeline,
        writeWhenChanged(() => timeline.snapshot(), setTimelineEntries),
      ),
    );
  }

  // Loads that finish before the toolbar settles are kept too.
  const asyncHistory = new AsyncHistory();
  const [asyncRecords, setAsyncRecords] = createSignal<AsyncRecord[]>([]);
  if (!isServer) {
    onCleanup(
      startAsyncCapture(
        asyncHistory,
        writeWhenChanged(() => asyncHistory.records, setAsyncRecords),
      ),
    );
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

  async function copySession(): Promise<string> {
    // Loaded on use: mapping stacks needs the source-map reader the error panel loads lazily.
    const [{ resolveErrorFrames }, { SESSION_ERRORS, sessionReport }] = await Promise.all([
      import('./report/error-report.js'),
      import('./report/session-report.js'),
    ]);
    const recent = errors().slice(0, SESSION_ERRORS);
    const resolved = await Promise.all(
      recent.map(async ({ error }) => ({ error, frames: await resolveErrorFrames(error) })),
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

  // The pull tab reads out the counts it shows.
  function handleLabel(): string {
    const counts: string[] = [];
    if (errors().length) counts.push(`${errors().length} errors`);
    if (issueCount()) counts.push(`${issueCount()} issues`);
    return ['Open Start Devtools', ...counts].join(', ');
  }

  // An action's label, for an error that was thrown during it.
  function describeOrigin(origin: object): string | undefined {
    for (const entry of timelineEntries()) {
      if (entry.origin === origin) return entry.label;
    }
    return undefined;
  }

  function pickFromPalette(target: PaletteTarget) {
    if (target.kind === 'component') showOwner(target.owner);
    else if (target.kind === 'memo' || target.kind === 'signal') showInGraph(target.node);
    else if (target.kind === 'action') {
      if (target.origin) showInActivity({ origin: target.origin });
      else show('activity');
    } else if (target.kind === 'call') showInActivity({ instance: target.instance });
  }

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
            aria-label={handleLabel()}
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
              <Show when={solidVersion()}>{(value) => <SolidVersion value={value()} />}</Show>
              <Show when={errors().length}>
                {(count) => <span data-solid-dev-toolbar-handle-errors>{count()}</span>}
              </Show>
              <Show when={issueCount()}>
                {(count) => <span data-solid-dev-toolbar-handle-issues>{count()}</span>}
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
              <Show when={open()}>
                <SolidIcon title="" aria-hidden="true" />
              </Show>
              <Show when={solidVersion()}>{(value) => <SolidVersion value={value()} />}</Show>
              <span data-solid-dev-toolbar-route title="Current route">
                {route()}
              </span>
              <div
                data-solid-dev-toolbar-views
                role="tablist"
                aria-label="Views"
                onKeyDown={onViewKeyDown}
              >
                <For each={VIEWS}>
                  {(entry) => {
                    const selected = () => tab() === entry.value;
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-label={entry.label}
                        id={`solid-dev-toolbar-view-${entry.value}`}
                        aria-selected={selected() ? 'true' : 'false'}
                        aria-controls="solid-dev-toolbar-body"
                        tabindex={selected() ? 0 : -1}
                        data-solid-dev-toolbar-view={entry.value}
                        onClick={() => show(entry.value)}
                      >
                        {entry.label}
                        <Show when={entry.value === 'health' && errors().length}>
                          {(count) => (
                            <span data-solid-dev-toolbar-tab-badge="failure">{count()}</span>
                          )}
                        </Show>
                        <Show when={entry.value === 'health' && issueCount()}>
                          {(count) => (
                            <span data-solid-dev-toolbar-tab-badge="warning">{count()}</span>
                          )}
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
              <div data-solid-dev-toolbar-spacer />
              <button
                type="button"
                data-solid-dev-toolbar-search
                aria-haspopup="dialog"
                onClick={() => setPaletteOpen(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m20 20-4.5-4.5" />
                </svg>
                <span>Find signal, component, call</span>
                <kbd>⌘K</kbd>
              </button>
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
            <div
              data-solid-dev-toolbar-body
              id="solid-dev-toolbar-body"
              role="tabpanel"
              aria-labelledby={`solid-dev-toolbar-view-${tab()}`}
            >
              <HealthViewer
                show={visible('health')}
                errors={errors()}
                resetError={resetError}
                issues={issues()}
                onClearIssues={() => setIssues([])}
                onViewOwner={showOwner}
                onViewInGraph={showInGraph}
                describeOrigin={describeOrigin}
                onShowInActivity={(origin: object) => showInActivity({ origin })}
              />
              <ActivityViewer
                show={visible('activity')}
                entries={timelineEntries()}
                history={asyncHistory}
                records={asyncRecords()}
                instances={instances()}
                errors={errors()}
                focus={activityFocus()}
                onClear={() => {
                  timeline.clear();
                  setTimelineEntries([]);
                  asyncHistory.clear();
                  setAsyncRecords([]);
                }}
                onDeleteInstance={(value: string) => {
                  setInstances((current) => {
                    const next = { ...current };
                    delete next[value];
                    return next;
                  });
                }}
                onViewInGraph={showInGraph}
                onViewOwner={showOwner}
                onShowInStructure={showInGraph}
                onShowError={() => show('health')}
              />
              <StructureViewer
                show={visible('structure')}
                mode={structureMode()}
                onModeChange={changeStructureMode}
                focus={graphFocus()}
                ownerFocus={ownershipFocus()}
                ownerFilter={selectedComponent()?.owner}
                componentFilter={selectedComponent()?.name}
                onClearComponentFilter={clearComponentFunnel}
                onViewOwner={showOwner}
                onViewInGraph={showInGraph}
                lastChange={(_id: string | number, node?: object) =>
                  node ? signalHistory.lastChange(node) : undefined
                }
                onShowActivity={(_owner: object, name: string) =>
                  showInActivity({ ownerName: name })
                }
              />
            </div>
          </div>
          <Show when={paletteOpen()}>
            <div data-solid-dev-toolbar-palette-layer>
              <CommandPalette
                entries={timelineEntries()}
                instances={instances()}
                onPick={pickFromPalette}
                onClose={() => setPaletteOpen(false)}
              />
            </div>
          </Show>
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
