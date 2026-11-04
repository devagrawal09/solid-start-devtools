import { createSignal, onSettled } from 'solid-js';

export const DEFAULT_DETAIL_WIDTH = 320;
export const MIN_DETAIL_WIDTH = 240;
/** The narrowest the tree or graph beside a detail pane may get. */
export const MIN_MAIN_WIDTH = 240;
/** How far one arrow key press moves the edge. */
export const KEYBOARD_STEP = 16;

function readSavedWidth(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeSavedWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // Storage can be blocked.
  }
}

/** The widest a detail pane may get inside a panel `panelWidth` wide. */
export function maxDetailWidth(panelWidth: number, min = MIN_DETAIL_WIDTH): number {
  return Math.max(min, panelWidth - MIN_MAIN_WIDTH);
}

export function clampDetailWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(width, min), max));
}

export interface UseResizableDetailOptions {
  /** Each pane keeps its own width. */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
}

export interface ResizableDetail {
  width: () => number;
  minWidth: number;
  /** Starts a drag. `panelWidth` is the width of the panel the pane sits in. */
  start: (panelWidth: number) => void;
  /** Moves the edge `offsetX` pixels to the left of where the drag started. */
  drag: (offsetX: number) => void;
  /** Moves the edge `deltaX` pixels to the left now, and saves the width. */
  step: (deltaX: number, panelWidth: number) => void;
  end: () => void;
  reset: () => void;
}

export function useResizableDetail(options: UseResizableDetailOptions): ResizableDetail {
  const key = options.storageKey;
  const initial = options.defaultWidth ?? DEFAULT_DETAIL_WIDTH;
  const min = options.minWidth ?? MIN_DETAIL_WIDTH;

  const [width, setWidth] = createSignal(initial);
  let startWidth = initial;
  let max = Number.POSITIVE_INFINITY;

  onSettled(() => {
    const saved = readSavedWidth(key);
    if (typeof saved === 'number') setWidth(Math.max(Math.round(saved), min));
  });

  function start(panelWidth: number): void {
    max = maxDetailWidth(panelWidth, min);
    // A saved width can be wider than the panel allows now; CSS shows it clamped.
    startWidth = clampDetailWidth(width(), min, max);
  }

  // Measured from the start of the drag, so the edge stays under the pointer
  // after it passes a limit and comes back.
  function drag(offsetX: number): void {
    setWidth(clampDetailWidth(startWidth + offsetX, min, max));
  }

  function step(deltaX: number, panelWidth: number): void {
    start(panelWidth);
    drag(deltaX);
    end();
  }

  function end(): void {
    writeSavedWidth(key, width());
  }

  function reset(): void {
    setWidth(initial);
    writeSavedWidth(key, initial);
  }

  return { width, minWidth: min, start, drag, step, end, reset };
}
