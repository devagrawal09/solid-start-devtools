import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  clampDetailWidth,
  maxDetailWidth,
  MIN_DETAIL_WIDTH,
  MIN_MAIN_WIDTH,
  useResizableDetail,
} from './use-resizable-detail.js';

describe('clampDetailWidth', () => {
  it('keeps width within bounds', () => {
    expect(clampDetailWidth(300, 200, 600)).toBe(300);
    expect(clampDetailWidth(150, 200, 600)).toBe(200);
    expect(clampDetailWidth(750, 200, 600)).toBe(600);
  });

  it('rounds non-integer widths', () => {
    expect(clampDetailWidth(300.4, 200, 600)).toBe(300);
    expect(clampDetailWidth(300.6, 200, 600)).toBe(301);
  });
});

describe('maxDetailWidth', () => {
  it('leaves room for the tree beside the pane', () => {
    expect(maxDetailWidth(1000)).toBe(1000 - MIN_MAIN_WIDTH);
  });

  it('never goes below the minimum width', () => {
    expect(maxDetailWidth(300)).toBe(MIN_DETAIL_WIDTH);
  });
});

describe('useResizableDetail', () => {
  function detail() {
    return createRoot(() => useResizableDetail({ storageKey: 'test', defaultWidth: 320 }));
  }

  it('keeps the edge under the pointer after passing a limit', () => {
    const pane = detail();
    pane.start(1000);
    // 100px past the minimum, then 50px back: still past it.
    pane.drag(-(320 - MIN_DETAIL_WIDTH) - 100);
    expect(pane.width()).toBe(MIN_DETAIL_WIDTH);
    pane.drag(-(320 - MIN_DETAIL_WIDTH) - 50);
    expect(pane.width()).toBe(MIN_DETAIL_WIDTH);
    pane.drag(40);
    expect(pane.width()).toBe(360);
  });

  it('stops at the width the panel allows', () => {
    const pane = detail();
    pane.start(800);
    pane.drag(1000);
    expect(pane.width()).toBe(800 - MIN_MAIN_WIDTH);
  });

  it('steps from the current width', () => {
    const pane = detail();
    pane.step(16, 1000);
    pane.step(16, 1000);
    expect(pane.width()).toBe(352);
    pane.reset();
    expect(pane.width()).toBe(320);
  });
});
