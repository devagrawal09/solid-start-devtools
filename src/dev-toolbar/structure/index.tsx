import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import OwnershipViewer, { type SignalChange } from '../ownership/index.js';
import ReactivityViewer from '../reactivity/index.js';
import {
  mountRxMap,
  readRxMapHost,
  type RxMapHost,
  shownStructureMode,
  type StructureMode,
  stepStructureMode,
  structureModes,
} from './rx-map.js';
import './styles.css';

export type { RxMapHost, SignalChange, StructureMode };

export interface StructureViewerProps {
  show?: boolean;
  /**
   * Which pane the view shows. Leave it out to let the view keep its own. Map
   * falls back to Owners while the app has no ReactiveScript map.
   */
  mode?: StructureMode;
  onModeChange?: (mode: StructureMode) => void;
  /** A signal, memo or effect another panel asked the graph to show. */
  focus?: { node: object };
  /** An owner another panel asked the tree to show. Pass a new object for every request. */
  ownerFocus?: { owner: object };
  /** Graph: only nodes owned by or under this component instance. */
  ownerFilter?: object;
  /** Graph: only nodes owned by or under a component of this name. */
  componentFilter?: string;
  onClearComponentFilter?: () => void;
  /** Graph: opens the owner of a node in the tree. */
  onViewOwner?: (owner: object) => void;
  /** Tree: opens a signal, memo or effect in the graph. */
  onViewInGraph?: (node: object) => void;
  /** The last change of a signal, from the timeline. The second argument is the runtime signal. */
  lastChange?: (nodeId: string | number, node?: object) => SignalChange | undefined;
  /** Opens the activity of an owner. */
  onShowActivity?: (owner: object, name: string) => void;
}

const MODES: Record<StructureMode, { label: string; name: string }> = {
  owners: { label: 'Owners', name: 'Ownership' },
  graph: { label: 'Graph', name: 'Reactivity' },
  map: { label: 'Map', name: 'ReactiveScript map' },
};

interface ModeChipsProps {
  modes: StructureMode[];
  mode: StructureMode;
  onChange: (mode: StructureMode) => void;
}

/** The Owners, Graph and Map chips. Every pane of the view shows them. */
function ModeChips(props: ModeChipsProps): JSX.Element {
  function moveMode(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // Each pane has its own chips, so the pane that takes over is searched from
    // the dock body: this chip leaves the page with its pane.
    const chip = event.currentTarget as HTMLElement | null;
    const body = chip?.closest('[data-solid-dev-toolbar-body]') ?? chip?.parentElement;
    props.onChange(stepStructureMode(props.modes, props.mode, event.key === 'ArrowLeft' ? -1 : 1));
    // The chip that takes over is the one that is now selected.
    queueMicrotask(() => {
      body
        ?.querySelector<HTMLElement>('[data-solid-structure-chip][aria-selected="true"]')
        ?.focus();
    });
  }

  return (
    <div data-solid-structure-modes role="tablist" aria-label="Structure">
      <For each={props.modes}>
        {(value) => (
          <button
            type="button"
            role="tab"
            data-solid-structure-chip
            data-solid-structure-mode={value}
            aria-label={MODES[value].name}
            aria-selected={props.mode === value ? 'true' : 'false'}
            tabindex={props.mode === value ? 0 : -1}
            onClick={() => props.onChange(value)}
            onKeyDown={moveMode}
          >
            {MODES[value].label}
          </button>
        )}
      </For>
    </div>
  );
}

interface RxMapPaneProps {
  host: RxMapHost;
  lead: JSX.Element;
}

/**
 * The live map of a ReactiveScript app. The app's `__RX__.mount` draws it into
 * the frame once the pane is on the page, and the pane takes it out again when
 * it closes.
 */
function RxMapPane(props: RxMapPaneProps): JSX.Element {
  let frame: HTMLDivElement | undefined;
  const host = props.host;
  onSettled(() => (frame ? mountRxMap(host, frame) : undefined));

  return (
    <div data-solid-dev-toolbar-panel>
      <div data-solid-rx-map-viewer>
        <div data-solid-rx-map-nav>{props.lead}</div>
        <div
          data-solid-rx-map-frame
          ref={(element) => {
            frame = element;
          }}
        />
      </div>
    </div>
  );
}

/**
 * The Structure view: the ownership tree and the reactivity graph behind a row
 * of chips, plus the ReactiveScript map when the app registered one. Selecting
 * a chip swaps the pane, and the tree and the graph keep their own selection
 * while they are hidden.
 */
export default function StructureViewer(props: StructureViewerProps): JSX.Element {
  const [ownMode, setOwnMode] = createSignal<StructureMode>('owners');

  // The app's dev entry registers the map, usually before the toolbar mounts.
  // It is read again each time the view opens, in case it came later.
  const [mapHost, setMapHost] = createSignal<RxMapHost | undefined>(readRxMapHost());
  createEffect(
    () => !!props.show,
    (shown) => {
      if (shown) setMapHost(readRxMapHost());
    },
  );

  const modes = createMemo(() => structureModes(!!mapHost()));
  const mode = () => shownStructureMode(props.mode ?? ownMode(), !!mapHost());

  function changeMode(next: StructureMode): void {
    setOwnMode(next);
    props.onModeChange?.(next);
  }

  const chips = () => <ModeChips modes={modes()} mode={mode()} onChange={changeMode} />;

  return (
    <>
      <OwnershipViewer
        show={!!props.show && mode() === 'owners'}
        focus={props.ownerFocus}
        onViewInGraph={props.onViewInGraph}
        lastChange={props.lastChange}
        onShowActivity={props.onShowActivity}
        lead={chips()}
      />
      <ReactivityViewer
        show={!!props.show && mode() === 'graph'}
        focus={props.focus}
        ownerFilter={props.ownerFilter}
        componentFilter={props.componentFilter}
        onClearComponentFilter={props.onClearComponentFilter}
        onViewOwner={props.onViewOwner}
        lead={chips()}
      />
      <Show when={props.show && mode() === 'map' && mapHost()} keyed>
        {(host) => <RxMapPane host={host} lead={chips()} />}
      </Show>
    </>
  );
}
