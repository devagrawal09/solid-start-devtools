import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';
import { KEYBOARD_STEP, maxDetailWidth, type ResizableDetail } from './use-resizable-detail.js';
import './ResizeHandle.css';

export interface ResizeHandleProps {
  detail: ResizableDetail;
  title?: string;
}

/** The left edge of a detail pane. The pane is the handle's parent, inside the panel. */
export function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [panelWidth, setPanelWidth] = createSignal(0);
  let handle: HTMLDivElement | undefined;

  function measurePanel(): number {
    const width = handle?.parentElement?.parentElement?.clientWidth ?? 0;
    setPanelWidth(width);
    return width;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragging(true);
    props.detail.start(measurePanel());
    const startX = event.clientX;

    function onPointerMove(next: PointerEvent): void {
      props.detail.drag(startX - next.clientX);
    }

    function onPointerUp(): void {
      setDragging(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      props.detail.end();
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  // The handle is the pane's left edge, so the left arrow widens the pane.
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') props.detail.step(KEYBOARD_STEP, measurePanel());
    else if (event.key === 'ArrowRight') props.detail.step(-KEYBOARD_STEP, measurePanel());
    else return;
    event.preventDefault();
  }

  return (
    <div
      ref={handle}
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize the detail pane"
      aria-valuenow={props.detail.width()}
      aria-valuemin={props.detail.minWidth}
      aria-valuemax={panelWidth() ? maxDetailWidth(panelWidth(), props.detail.minWidth) : undefined}
      data-solid-resize-handle
      data-dragging={dragging() ? '' : undefined}
      title={props.title ?? 'Drag to resize, double-click to reset'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onFocus={measurePanel}
      onDblClick={() => props.detail.reset()}
    />
  );
}
