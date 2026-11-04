import { expect, type Page, test } from '@playwright/test';
import { createRequestEvent, renderToString } from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import { build } from 'vite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = path.join(root, 'tests/fixture');

async function readJavaScript(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) return readJavaScript(current);
      if (entry.name.endsWith('.js')) return readFile(current, 'utf8');
      return '';
    }),
  );
  return sources.join('\n');
}

// Opens the dock on a tab. The dock sits below the page, which can scroll past
// it, so the fixture stays clickable while it is open.
async function openTab(page: Page, name: string) {
  const launcher = page.getByRole('button', { name: 'Open Start Devtools' });
  if (await launcher.isVisible()) await launcher.click();
  await page.getByRole('tab', { name, exact: true }).click();
}

test('renders the toolbar around the app', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-solid-dev-toolbar]')).toHaveCount(1);
  await expect(page.locator('#fixture-content')).toHaveText('app content');
});

test('docks at the bottom of the page', async ({ page }) => {
  await page.goto('/');
  const dock = page.getByRole('region', { name: 'Start Devtools' });
  await expect(dock).toBeHidden();

  await page.getByRole('button', { name: 'Open Start Devtools' }).click();
  await expect(dock).toBeVisible();
  const box = (await dock.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  // The page can scroll past the dock.
  expect(await page.evaluate(() => document.documentElement.style.paddingBottom)).toBe(
    `${box.height}px`,
  );

  // Dragging the top edge resizes it, and a reload keeps the height and the tab.
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  await page.mouse.move(viewport.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, box.y - 100, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await dock.boundingBox())!.height).toBe(box.height + 100);

  await page.reload();
  await expect(dock).toBeVisible();
  await expect.poll(async () => (await dock.boundingBox())!.height).toBe(box.height + 100);
  await expect(page.getByRole('tab', { name: 'Ownership', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('button', { name: 'Close Start Devtools' }).click();
  await expect(dock).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.paddingBottom)).toBe('');

  // Closing is remembered too.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Start Devtools' })).toBeVisible();
  await expect(dock).toBeHidden();
});

test('opens the dock from its pull tab', async ({ page }) => {
  await page.goto('/');
  const dock = page.getByRole('region', { name: 'Start Devtools' });
  const handle = page.getByRole('button', { name: 'Open Start Devtools' });
  const viewport = page.viewportSize()!;

  // Closed, the tab is a grip on the bottom edge that leaves the page alone.
  const grip = (await handle.boundingBox())!;
  expect(Math.round(grip.y + grip.height)).toBe(viewport.height);
  expect(grip.height).toBeLessThan(16);
  expect(await page.evaluate(() => document.documentElement.style.paddingBottom)).toBe('');

  // Dragging it up opens the dock to where the pointer stops.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height - 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, viewport.height - 300, { steps: 6 });
  await page.mouse.up();
  await expect(dock).toBeVisible();
  await expect.poll(async () => (await dock.boundingBox())!.height).toBe(300);
  await expect(handle).toBeHidden();

  // Alt+Shift+D toggles it.
  await page.keyboard.press('Alt+Shift+KeyD');
  await expect(dock).toBeHidden();
  await page.keyboard.press('Alt+Shift+KeyD');
  await expect(dock).toBeVisible();
});

test('moves focus with the dock and leaves typing alone', async ({ page }) => {
  await page.goto('/');
  const dock = page.getByRole('region', { name: 'Start Devtools' });
  const handle = page.getByRole('button', { name: 'Open Start Devtools' });

  // Opening focuses the selected tab, and closing focuses the handle.
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Server functions', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Ownership', exact: true })).toBeFocused();
  await page.keyboard.press('Alt+Shift+KeyD');
  await expect(dock).toBeHidden();
  await expect(handle).toBeFocused();

  // The shortcut does nothing inside a text field.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'shortcut-input';
    document.body.append(input);
  });
  await page.locator('#shortcut-input').focus();
  await page.keyboard.press('Alt+Shift+KeyD');
  await expect(dock).toBeHidden();
});

test('fits the dock and the padding to the window', async ({ page }) => {
  // A stored `null` falls back to the defaults.
  await page.addInitScript(() => localStorage.setItem('solid-start-devtools:dock', 'null'));
  await page.goto('/');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'html { padding-bottom: 20px; }';
    document.head.append(style);
  });
  const dock = page.getByRole('region', { name: 'Start Devtools' });
  await page.getByRole('button', { name: 'Open Start Devtools' }).click();
  await expect(dock).toBeVisible();

  // The dock's height is added to the page's own padding.
  const height = (await dock.boundingBox())!.height;
  expect(await page.evaluate(() => document.documentElement.style.paddingBottom)).toBe(
    `${height + 20}px`,
  );

  // A smaller window shrinks the dock to 90% of it, and the padding follows.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 300 });
  await expect.poll(async () => (await dock.boundingBox())!.height).toBe(270);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.paddingBottom))
    .toBe('290px');

  await page.getByRole('button', { name: 'Close Start Devtools' }).click();
  expect(await page.evaluate(() => document.documentElement.style.paddingBottom)).toBe('');
});

test('captures client errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#throw-client-error').click();

  // An error opens the dock on its tab.
  await expect(page.getByRole('tab', { name: 'Errors', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expect(page.locator('[data-solid-error-viewer-error-info-message]')).toHaveText(
    'client boom',
  );

  // Frames come from the parsed stack, so an empty list means the parser broke.
  const frames = page.locator('[data-solid-error-viewer-stack-frame]');
  await expect(frames.first()).toContainText('app.tsx');

  // The source is highlighted, and the frame's line and word are marked by the
  // directives the panel writes above the snippet.
  const code = page.locator('[data-solid-error-viewer-code-view]').first();
  await expect(code.locator('.twinkleplop')).toBeVisible();
  await expect(code.locator('.l.focus')).toHaveCount(1);
  await expect(code.locator('.l.focus')).toContainText('client boom');
  await expect(code.locator('.tok.error')).toHaveCount(1);

  // The window around the frame is what the view scrolls through: lines near
  // it are there, lines far from it are not.
  await expect(code).toContainText('emitServerFunctionResponse');
  await expect(code).not.toContainText('__disposeToolbar');

  // It opens on the frame instead of the top of the file.
  expect(
    await code.evaluate((view) => {
      const focused = view.querySelector('.focus')!.getBoundingClientRect();
      const box = view.getBoundingClientRect();
      return focused.top >= box.top && focused.bottom <= box.bottom;
    }),
  ).toBe(true);

  // The markers themselves never reach the reader.
  await expect(code).not.toContainText('[!focus');
  await expect(code).not.toContainText('[!err');
});

test('shows server-function calls', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });

  await page.goto('/');
  const instances = page.locator('[data-solid-functions-instances]');

  await page.locator('#emit-server-function-request').click();
  await openTab(page, 'Server functions');
  await expect(instances).toContainText('loadUser');
  await expect(page.getByRole('tab', { name: 'Server functions' })).toContainText('1');

  await page.locator('#emit-server-function-response').click();
  await expect(instances).toContainText('201');

  await page.locator('#emit-server-function-response').click();
  await expect(instances).toContainText('500');

  // The detail pane starts empty and fills in once a call is selected.
  const detail = page.locator('[data-solid-functions-detail]');
  await expect(detail).toContainText('Select a server function call.');
  await page.locator('[data-solid-functions-instances] [data-solid-select-option]').first().click();
  await expect(detail.locator('[data-solid-function-instance-viewer]')).toBeVisible();

  expect(warnings).not.toContainEqual(expect.stringContaining('STRICT_READ_UNTRACKED'));
});

test('shows the arguments and files of an upload call', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.locator('#emit-upload-request').click();
  await openTab(page, 'Server functions');
  await page
    .locator('[data-solid-functions-instances] [data-solid-select-option]', {
      hasText: 'uploadAvatar',
    })
    .click();

  const detail = page.locator('[data-solid-functions-detail]');
  await expect(detail.locator('[data-solid-seroval-viewer]')).toContainText('note');
  await expect(detail.locator('[data-solid-form-data-viewer]')).toContainText('file0');
  await expect(detail.locator('[data-solid-blob-viewer-name]')).toContainText('avatar.txt');
  expect(errors).toEqual([]);
});

test('maps the reactivity graph', async ({ page }) => {
  await page.goto('/');
  const nodes = page.locator('[data-solid-reactivity-node]');
  const count = nodes.filter({ hasText: /^count/ }).first();

  await openTab(page, 'Reactivity');
  await expect(count).toBeVisible();
  await expect(nodes.filter({ hasText: /^doubled/ }).first()).toBeVisible();
  await expect(nodes.filter({ hasText: /^report-doubled/ }).first()).toBeVisible();

  // Effects that subscribe to nothing sit in their own column before the signals.
  const columns = await nodes.evaluateAll((elements) =>
    elements.map((element) => ({
      x: Math.round(element.getBoundingClientRect().x),
      kind: (element as HTMLElement).dataset.kind,
    })),
  );
  const leftmost = Math.min(...columns.map((entry) => entry.x));
  expect(
    columns
      .filter((entry) => entry.x === leftmost)
      .every((entry) => entry.kind?.includes('effect')),
  ).toBe(true);
  expect(columns.some((entry) => entry.kind === 'signal' && entry.x > leftmost)).toBe(true);

  // Hovering a node explains it without selecting it.
  await count.hover();
  const card = page.locator('[data-solid-reactivity-hovercard]');
  await expect(card).toContainText('number');
  await expect(card).toContainText('2 out');

  // The card sits above or below the node, never over it.
  const cardBox = (await card.boundingBox())!;
  const nodeBox = (await count.boundingBox())!;
  expect(cardBox.y + cardBox.height <= nodeBox.y || cardBox.y >= nodeBox.y + nodeBox.height).toBe(
    true,
  );

  // The detail pane only appears once a node is selected.
  await expect(page.locator('[data-solid-reactivity-detail]')).toHaveCount(0);

  // Selecting a node lists what reads it and dims the rest of the graph.
  await count.click();
  const detail = page.locator('[data-solid-reactivity-detail]');
  await expect(detail).toContainText('Observers (2)');
  await expect(detail.locator('[data-solid-reactivity-link]').first()).toContainText('doubled');
  await expect(nodes.filter({ hasText: /^doubled/ }).first()).toHaveAttribute(
    'data-solid-reactivity-node',
    'downstream',
  );

  await page.locator('#increment-count').click();
  await expect(count).toContainText('1');
  await expect(nodes.filter({ hasText: /^doubled/ }).first()).toContainText('2');

  // The value pane is the same expandable tree the server function viewer uses.
  const tree = page.locator('[data-solid-reactivity-detail-value]');
  await expect(tree.locator('[data-solid-value-token="number"]')).toHaveText('1');

  await nodes
    .filter({ hasText: /^effect\[/ })
    .first()
    .click();
  await expect(tree.locator('[data-solid-value-tree-row]').first()).toContainText('array');
  await expect(tree.locator('[data-solid-value-tree-key]').first()).toContainText('0');
  await expect(tree).toContainText('<main>');

  // Filters drop a whole kind from the graph.
  await count.click();
  await page.getByRole('button', { name: 'Memos' }).click();
  await expect(nodes.filter({ hasText: /^doubled/ })).toHaveCount(0);
  await expect(count).toBeVisible();

  // The owner field opens the ownership tree on the component that owns the node.
  if ((await count.getAttribute('data-solid-reactivity-node')) !== 'selected') {
    await count.click();
  }
  // The path names the components the app declared, not the toolbar around it.
  await expect(
    page.locator('[data-solid-reactivity-detail] [data-solid-reactivity-owner]'),
  ).toHaveText('<App> › <Counter>');
  await page.locator('[data-solid-reactivity-detail] [data-solid-reactivity-owner]').click();
  await expect(page.locator('[data-solid-ownership-row][data-selected]')).toContainText(
    '<Counter>',
  );
});

test('maps the ownership tree', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('[data-solid-ownership-name]');

  await openTab(page, 'Ownership');
  await expect(rows).toHaveText(['<App>', '<Greeting>', '<Counter>', '<Show>', '<Show>', '<Show>']);

  // The expand arrow keeps its full size inside the button.
  const arrow = await page
    .locator('[data-solid-ownership-chevron]')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return [style.width, style.height];
    });
  expect(arrow).toEqual(['5px', '5px']);

  // The detail pane only appears once an owner is selected.
  await expect(page.locator('[data-solid-ownership-detail]')).toHaveCount(0);

  // A component owns the signals and scopes created inside it.
  await page.locator('[data-solid-ownership-label]').filter({ hasText: '<Counter>' }).click();
  const detail = page.locator('[data-solid-ownership-detail]');
  await expect(detail).toContainText('Signals (1)');
  await expect(detail).toContainText('count');
  await expect(detail).toContainText('doubled');

  // Values stay live while the panel is open, even when the tree does not move.
  // The panel covers the page, so the click goes straight to the element.
  await page.evaluate(() => (document.querySelector('#increment-count') as HTMLElement).click());
  await expect(
    detail
      .locator('[data-solid-ownership-signal]')
      .filter({ has: page.getByText('count', { exact: true }) }),
  ).toContainText('1');

  // Props are listed by name, never read.
  await page.locator('[data-solid-ownership-label]').filter({ hasText: '<Greeting>' }).click();
  await expect(detail).toContainText('Props (1)');
  await expect(detail).toContainText('name');

  // The ancestry section lists the owners above the selection, nearest first.
  const frames = detail.locator('[data-solid-ownership-frame]');
  await expect(frames).toHaveCount(2);
  await expect(frames.first()).toContainText('<Greeting>');
  await expect(frames.nth(1)).toContainText('<App>');

  // Clicking a frame walks up the tree.
  await frames.nth(1).click();
  await expect(detail.locator('[data-solid-ownership-detail-head]')).toContainText('<App>');

  // Owner mode adds the scopes that component mode folds away.
  await page.getByRole('button', { name: 'Owners', exact: true }).click();
  await expect(rows.filter({ hasText: /^doubled$/ })).toHaveCount(1);

  // Search keeps the ancestors of a match so the row stays reachable.
  await page.getByRole('button', { name: 'Components', exact: true }).click();
  await page.locator('[data-solid-ownership-search]').fill('doubled');
  await expect(rows).toHaveText(['<App>', '<Counter>']);

  // Rows carry no count badges.
  await expect(page.locator('[data-solid-ownership-row] [data-solid-badge="info"]')).toHaveCount(0);

  // A signal opens in the reactivity graph with that node selected.
  await page.locator('[data-solid-ownership-search]').fill('');
  await page.locator('[data-solid-ownership-label]').filter({ hasText: '<Counter>' }).click();
  const countEntry = detail
    .locator('[data-solid-ownership-signal]')
    .filter({ has: page.getByText('count', { exact: true }) });
  await countEntry.hover();
  await countEntry.getByRole('button', { name: 'View in graph' }).click();
  await expect(
    page
      .locator('[data-solid-reactivity-node]')
      .filter({ hasText: /^count/ })
      .first(),
  ).toHaveAttribute('data-solid-reactivity-node', 'selected');

  // The node lands in the middle of the canvas, measured after the detail pane
  // has narrowed it.
  await expect
    .poll(async () => {
      const canvasBox = (await page.locator('[data-solid-reactivity-canvas]').boundingBox())!;
      const nodeBox = (await page
        .locator('[data-solid-reactivity-node="selected"]')
        .first()
        .boundingBox())!;
      return Math.abs(nodeBox.x + nodeBox.width / 2 - (canvasBox.x + canvasBox.width / 2));
    })
    .toBeLessThan(4);

  // The graph keeps watching after the jump. The ownership panel stops in the
  // same flush the graph starts, which used to take the graph's hooks away.
  // The panel covers the page, so the click goes straight to the element.
  await page.evaluate(() => (document.querySelector('#increment-count') as HTMLElement).click());
  await expect(
    page
      .locator('[data-solid-reactivity-node]')
      .filter({ hasText: /^count/ })
      .first(),
  ).toContainText('2');

  // In owner mode a memo is a row of its own, and its heading links to the graph.
  await openTab(page, 'Ownership');
  await page.getByRole('button', { name: 'Owners', exact: true }).click();
  await page
    .locator('[data-solid-ownership-label]')
    .filter({ hasText: /^doubled$/ })
    .click();

  // The ownership detail pane can be resized horizontally by dragging its left edge handle.
  const handle = detail.locator('[data-solid-resize-handle]');
  await expect(handle).toBeVisible();
  const initialWidth = (await detail.boundingBox())!.width;

  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100);
  await page.mouse.down();
  // Drag left by 100px to widen the detail pane
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 100, handleBox.y + 100);
  await page.mouse.up();

  const expandedWidth = (await detail.boundingBox())!.width;
  expect(expandedWidth).toBeGreaterThan(initialWidth + 80);

  // Double click resets the width
  await handle.dblclick();
  const resetWidth = (await detail.boundingBox())!.width;
  expect(Math.abs(resetWidth - 320)).toBeLessThanOrEqual(2);

  // The left arrow key widens the pane from the keyboard.
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '336');

  await detail
    .locator('[data-solid-ownership-detail-head]')
    .getByRole('button', { name: 'View in graph' })
    .click();
  await expect(
    page
      .locator('[data-solid-reactivity-node]')
      .filter({ hasText: /^doubled/ })
      .first(),
  ).toHaveAttribute('data-solid-reactivity-node', 'selected');
});

test('lists runtime issues', async ({ page }) => {
  await page.goto('/');

  // Each render of the reader reports the same untracked read.
  for (let i = 0; i < 3; i++) await page.locator('#emit-warning').click();
  await openTab(page, 'Issues');
  await expect(page.getByRole('tab', { name: 'Issues', exact: true })).toContainText('2');

  const rows = page.locator('[data-solid-issues-row]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('STRICT_READ_UNTRACKED');
  await expect(rows.first()).toContainText('×2');
  // The toolbar's own owners are not part of the path.
  await expect(rows.first()).toContainText('<App> › <Show> › value › <DraftReader>');
  await expect(rows.first()).not.toContainText('<DevToolbar>');

  // The severity filter hides it.
  await page.locator('[data-solid-issues-filter="warn"]').click();
  await expect(rows).toHaveCount(0);
  await page.locator('[data-solid-issues-filter="warn"]').click();

  // The detail links to the component in the ownership tree.
  await rows.first().click();
  const detail = page.locator('[data-solid-issues-detail]');
  await expect(detail).toContainText('draft');
  await expect(detail.getByRole('link', { name: 'Open the repair guide' })).toHaveAttribute(
    'href',
    /diagnostics\/strict-read-untracked/,
  );
  await detail.getByRole('button', { name: 'Show in the ownership tree' }).click();
  await expect(page.locator('[data-solid-ownership-row][data-selected]')).toContainText(
    '<DraftReader>',
  );

  // Clearing empties the list and the count.
  await openTab(page, 'Issues');
  await page.getByRole('button', { name: 'Clear issues' }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Issues', exact: true })).not.toContainText('2');
});

test('shows what each action re-ran and why', async ({ page }) => {
  await page.goto('/');
  await page.locator('#increment-count').click();

  await openTab(page, 'Timeline');
  const rows = page.locator('[data-solid-timeline-row]');
  // Clicks on the toolbar change nothing in the app, so the click on the counter is the only entry.
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('click on button#increment-count');
  await expect(rows.first()).toContainText('1 write · 3 re-runs');
  await expect(rows.first()).toContainText('committed');

  await rows.first().click();
  const detail = page.locator('[data-solid-timeline-detail]');
  await expect(detail.locator('[data-solid-timeline-write]')).toHaveText(/write\s*count\s*0 → 1/);
  await expect(detail.locator('[data-solid-timeline-run-toggle]')).toHaveText([
    /doubled/,
    /effect/,
    /report-doubled/,
  ]);

  // An effect re-ran because the memo it reads changed, which the write caused.
  await detail
    .locator('[data-solid-timeline-run-toggle]')
    .filter({ hasText: 'report-doubled' })
    .click();
  const causes = detail.locator(
    '[data-solid-timeline-run][data-open] [data-solid-timeline-causes]',
  );
  await expect(causes.first()).toContainText('doubled changed');
  await expect(causes.first()).toContainText('count');

  // The eye opens the memo in the reactivity graph.
  await detail
    .locator('[data-solid-timeline-run]')
    .filter({ hasText: /^doubled/ })
    .getByRole('button', { name: 'View in graph' })
    .click();
  await expect(page.getByRole('tab', { name: 'Reactivity', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('[data-solid-reactivity-detail]')).toContainText('doubled');
});

test('lists the server calls of an action and opens them', async ({ page }) => {
  await page.goto('/');
  // The handler writes nothing, so the call is all the click did.
  await page.locator('#call-server').click();

  await openTab(page, 'Timeline');
  const row = page.locator('[data-solid-timeline-row]').filter({ hasText: 'button#call-server' });
  await expect(row).toContainText('1 call');
  await row.click();

  const call = page.locator('[data-solid-timeline-call]');
  await expect(call).toContainText('loadUser');
  await expect(call).toContainText('200');
  await call.click();

  await expect(page.getByRole('tab', { name: 'Server functions', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('[data-solid-function-instance-viewer]')).toContainText('loadUser');
});

test('shows async loads, waits, fallbacks and chains', async ({ page }) => {
  await page.goto('/');
  await openTab(page, 'Async');
  await expect(page.locator('[data-solid-async-now]')).toContainText('Nothing is loading.');

  await page.locator('#show-async').click();
  await expect(page.locator('#async-posts')).toHaveText('post of user 1');

  // While the next user loads, the panel lists what is loading.
  await page.locator('#next-user').click();
  await expect(page.locator('[data-solid-async-now]')).toContainText('user');
  await expect(page.locator('#async-posts')).toHaveText('post of user 2');
  await expect(page.locator('[data-solid-async-now]')).toContainText('Nothing is loading.');

  const rows = page.locator('[data-solid-async-row]');
  await expect(rows.filter({ hasText: 'load user' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'fallback at <App>' }).first()).toBeVisible();
  // posts starts only once user has landed.
  await expect(rows.filter({ hasText: 'chain user → posts' }).first()).toContainText(
    'loads ran one after another',
  );

  // The click held the write until both loads landed, and nothing on screen said so.
  // solid-js rc.20 lists what the click waited on in a different order than rc.13.
  const wait = rows.filter({ hasText: /wait on (user, posts|posts, user)/ }).first();
  await expect(wait).toContainText('no pending state shown');
  await wait.click();
  const detail = page.locator('[data-solid-async-detail]');
  await expect(detail).toContainText('click on button#next-user');
  await expect(detail).toContainText('userId 1 → 2');

  // The filter hides a kind of record.
  await page.locator('[data-solid-async-filter="chain"]').click();
  await expect(rows.filter({ hasText: 'chain user → posts' })).toHaveCount(0);

  // A load links to its node in the reactivity graph.
  await rows.filter({ hasText: 'load user' }).first().click();
  await detail.getByRole('button', { name: 'Show in the reactivity graph' }).click();
  await expect(page.locator('[data-solid-reactivity-detail]')).toContainText('user');
});

test('copies a report of the whole session', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await page.goto('/');
  await page.locator('#increment-count').click();
  await page.locator('#emit-warning').click();

  await openTab(page, 'Errors');
  await page.getByRole('button', { name: 'Copy the whole session for an agent' }).click();
  await expect.poll(clipboard).toContain('# Solid devtools session');
  const report = await clipboard();
  expect(report).toContain('## Issues (1)');
  expect(report).toContain('`STRICT_READ_UNTRACKED`');
  expect(report).toContain('## Recent actions, newest first');
  expect(report).toContain('click on button#increment-count');
  expect(report).not.toContain('## Errors');
});

test('hides updates that only touched unnamed signals', async ({ page }) => {
  await page.goto('/');
  // The Loading boundary settles through Solid's own unnamed signals.
  await page.locator('#show-async').click();
  await expect(page.locator('#async-posts')).toHaveText('post of user 1');

  await openTab(page, 'Timeline');
  const rows = page.locator('[data-solid-timeline-row]');
  const toggle = page.locator('[data-solid-timeline-unnamed]');
  await expect(toggle).toContainText(/Show \d+ unnamed update/);
  await expect(rows.filter({ hasText: /^update/ })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'button#show-async' })).toHaveCount(1);

  await toggle.click();
  await expect(toggle).toContainText(/Hide \d+ unnamed update/);
  expect(await rows.count()).toBeGreaterThan(1);
});

test('copies reports for an agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const copy = (name: string) =>
    page.getByRole('button', { name: `Copy ${name} for an agent` }).click();

  await page.goto('/');

  // An error, with its mapped stack and the source around the frame.
  await page.locator('#throw-client-error').click();
  await copy('this error');
  await expect.poll(clipboard).toContain('# Error in a Solid app');
  const error = await clipboard();
  expect(error).toContain('Error: client boom');
  expect(error).toMatch(/`Broken` at `[^`]*app\.tsx:\d+:\d+`/);
  expect(error).toContain("throw new Error('client boom');");
  // The caret points at the expression that threw.
  const lines = error.split('\n');
  const marked = lines.findIndex((line) => line.includes("throw new Error('client boom');"));
  expect(lines[marked + 1]!.indexOf('^')).toBe(lines[marked]!.indexOf('new'));

  // The error replaced the app, so the other panels start from a fresh page.
  await page.reload();

  // A server-function call, with both bodies.
  await page.locator('#emit-server-function-request').click();
  await page.locator('#emit-server-function-response').click();
  await openTab(page, 'Server functions');
  await page.locator('[data-solid-functions-instances] [data-solid-select-option]').first().click();
  await copy('this call');
  await expect.poll(clipboard).toContain('# Server function call: `loadUser`');
  expect(await clipboard()).toContain('- Response: `201`');

  // A component, with its signals and where it sits.
  await openTab(page, 'Ownership');
  await page.locator('[data-solid-ownership-label]').filter({ hasText: '<Counter>' }).click();
  await copy('this component');
  await expect.poll(clipboard).toContain('# Solid component: `<Counter>`');
  expect(await clipboard()).toContain('- `count` = `0`');

  // A memo, with what it reads and what reads it.
  await openTab(page, 'Reactivity');
  await page
    .locator('[data-solid-reactivity-node]')
    .filter({ hasText: /^doubled/ })
    .first()
    .click();
  await copy('this memo');
  await expect.poll(clipboard).toContain('# Solid memo: `doubled`');
  expect(await clipboard()).toContain('- signal `count` = `0`');
});

test('highlights fine-grained reactive updates with frequency colors', async ({ page }) => {
  await page.goto('/');

  // Open the devtools dock.
  await page.getByRole('button', { name: 'Open Start Devtools' }).click();
  const highlightButton = page.getByRole('button', {
    name: 'Highlight updates (Alt+Shift+H)',
  });
  await expect(highlightButton).toBeVisible();

  // 1. Enable highlight updates.
  await highlightButton.click();
  await expect(highlightButton).toHaveAttribute('data-active', '');

  // 2. Update the Counter, then read the overlay canvas in the middle of the
  // changed text and in the button's padding beside it. The click and the
  // reads run in one step, so the box cannot fade out in between.
  const updateAndSample = () =>
    page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>('#increment-count')!;
      button.click();
      // One frame for the tracker to collect the change, one to draw it, one to
      // be sure the draw ran before the reads.
      for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
      const canvas = document
        .querySelector('[data-solid-highlight-overlay]')!
        .shadowRoot!.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      const scale = canvas.width / window.innerWidth;
      const pixel = (x: number, y: number) => [
        ...ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data,
      ];
      const range = document.createRange();
      range.selectNodeContents(button.firstChild!);
      const text = range.getBoundingClientRect();
      const outer = button.getBoundingClientRect();
      return {
        text: pixel(text.left + text.width / 2, text.top + text.height / 2),
        padding: pixel((outer.left + text.left) / 2, text.top + text.height / 2),
      };
    });

  // The canvas stores colors with premultiplied alpha, so a read can be off by one.
  const expectColor = (pixel: number[], rgb: number[]) => {
    for (let i = 0; i < 3; i++) expect(Math.abs(pixel[i]! - rgb[i]!)).toBeLessThanOrEqual(3);
  };

  // First update is Solid light blue (#4483ec / rgb(68, 131, 236)), on the
  // text only.
  const first = await updateAndSample();
  expectColor(first.text, [68, 131, 236]);
  expect(first.text[3]).toBeGreaterThan(0);
  expect(first.padding[3]).toBe(0);

  // 3. Fast repeated update elevates color to purple (#9333ea / rgb(147, 51, 234)).
  const second = await updateAndSample();
  expectColor(second.text, [147, 51, 234]);

  // 4. Toggle off with shortcut Alt+Shift+H.
  await page.keyboard.press('Alt+Shift+H');
  await expect(highlightButton).not.toHaveAttribute('data-active', '');

  // 5. Toggle on again and verify persistence across reload.
  await page.keyboard.press('Alt+Shift+H');
  await expect(highlightButton).toHaveAttribute('data-active', '');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Highlight updates (Alt+Shift+H)' }),
  ).toHaveAttribute('data-active', '');
});

test('inspects elements and funnels components across panels', async ({ page }) => {
  await page.goto('/');

  // Open the devtools dock.
  await page.getByRole('button', { name: 'Open Start Devtools' }).click();
  const inspectButton = page.getByRole('button', { name: 'Inspect element (Alt+Shift+C)' });
  await expect(inspectButton).toBeVisible();

  // 1. Toggle inspect mode with the header button.
  await inspectButton.click();
  await expect(inspectButton).toHaveAttribute('data-active', '');

  // 2. Hover over a component's DOM element (<Counter />'s button).
  await page.locator('#increment-count').hover();
  const overlay = page.locator('[data-solid-inspector-overlay]');
  await expect(overlay).toBeVisible();
  await expect(page.locator('[data-solid-inspector-badge-name]')).toHaveText('<Counter>');
  await expect(page.locator('[data-solid-inspector-box]')).toBeVisible();
  await expect(page.locator('[data-solid-inspector-badge-size]')).toBeVisible();

  // 3. Click to select the component.
  await page.locator('#increment-count').click();
  await expect(overlay).toBeHidden();
  await expect(inspectButton).not.toHaveAttribute('data-active', '');

  // 4. Verify the funnel badge appears in the header.
  const funnel = page.locator('[data-solid-dev-toolbar-funnel]');
  await expect(funnel).toBeVisible();
  const funnelName = page.locator('[data-solid-dev-toolbar-funnel-name]');
  await expect(funnelName).toHaveText('<Counter>');

  // 5. Clicking the component name in the funnel jumps to the Ownership tree.
  await funnelName.click();
  await expect(page.getByRole('tab', { name: 'Ownership' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('[data-solid-ownership-row][data-selected]')).toContainText('Counter');
  await expect(page.locator('[data-solid-ownership-detail]')).toBeVisible();

  // 6. Switching to Reactivity isolates nodes belonging to the selected owner instance.
  await page.getByRole('tab', { name: 'Reactivity' }).click();
  const graphNodes = page.locator('[data-solid-reactivity-node-name]');
  await expect(graphNodes.filter({ hasText: 'count' })).toBeVisible();

  // 7. Clear the funnel.
  await page.getByRole('button', { name: 'Clear component funnel' }).click();
  await expect(funnel).toHaveCount(0);

  // 8. Test keyboard shortcut Alt+Shift+C and Escape cancel.
  await page.keyboard.press('Alt+Shift+C');
  await expect(inspectButton).toHaveAttribute('data-active', '');
  await page.locator('#fixture-greeting').hover();
  await expect(page.locator('[data-solid-inspector-badge-name]')).toHaveText('<Greeting>');
  await page.keyboard.press('Escape');
  await expect(inspectButton).not.toHaveAttribute('data-active', '');
  await expect(overlay).toBeHidden();
});

test('allows live editing of signal state and updates DOM', async ({ page }) => {
  await page.goto('/');

  // 1. Live edit via Ownership panel
  await openTab(page, 'Ownership');
  await page.locator('[data-solid-ownership-label]').filter({ hasText: '<Counter>' }).click();

  const countSignal = page
    .locator('[data-solid-ownership-signal]')
    .filter({ has: page.getByText('count', { exact: true }) });
  await expect(countSignal).toContainText('0');

  // Trigger inline edit
  await countSignal.hover();
  await countSignal.locator('[data-solid-ownership-edit-signal]').click();
  const ownershipInput = countSignal.locator('[data-solid-ownership-signal-input]');
  await expect(ownershipInput).toBeVisible();
  await ownershipInput.fill('42');
  await ownershipInput.press('Enter');

  // Verify state update in devtools and live app DOM
  await expect(countSignal).toContainText('42');
  await expect(page.locator('#increment-count')).toHaveText('count 42 doubled 84');
  expect(await page.evaluate(() => Reflect.get(window, '__doubled'))).toBe(84);

  // 2. Live edit via Reactivity Graph detail pane
  await openTab(page, 'Reactivity');
  const countNode = page
    .locator('[data-solid-reactivity-node]')
    .filter({ hasText: /^count/ })
    .first();
  await countNode.click();

  const detail = page.locator('[data-solid-reactivity-detail]');
  await expect(detail).toContainText('Value');

  const valueInputTrigger = detail.locator('[data-solid-value-edit-btn]');
  await valueInputTrigger.click();

  const reactivityInput = detail.locator('[data-solid-value-input]');
  await expect(reactivityInput).toBeVisible();
  await reactivityInput.fill('100');
  await reactivityInput.press('Enter');

  // Verify state update in devtools and live app DOM
  await expect(detail.locator('[data-solid-reactivity-detail-value]')).toContainText('100');
  await expect(page.locator('#increment-count')).toHaveText('count 100 doubled 200');
  expect(await page.evaluate(() => Reflect.get(window, '__doubled'))).toBe(200);
});

test('mounts once and disposes', async ({ page }) => {
  await page.goto('/?mount');

  await expect(page.locator('[data-solid-dev-toolbar]')).toHaveCount(1);
  expect(await page.evaluate(() => Reflect.get(window, '__sameDispose'))).toBe(true);
  await page.evaluate(() => Reflect.get(window, '__disposeToolbar')());
  await expect(page.locator('[data-solid-dev-toolbar]')).toHaveCount(0);
});

test('sets a 500 status for server render errors', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'dist/server.js')).href;
  const { DevToolbar } = await import(moduleUrl);
  const event = createRequestEvent(new Request('http://localhost/'));
  const originalError = console.error;
  console.error = () => {};

  try {
    const html = provideRequestEvent(event, () =>
      renderToString(() =>
        DevToolbar({
          get children() {
            throw new Error('server boom');
          },
        }),
      ),
    );
    await Promise.resolve();

    expect(event.response.status).toBe(500);
    expect(html).toContain('server boom');
  } finally {
    console.error = originalError;
  }
});

test('removes the toolbar from production bundles', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'start-devtools-'));

  try {
    await build({
      configFile: path.join(fixture, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const output = await readJavaScript(outDir);

    expect(output).not.toContain('data-solid-dev-toolbar');
    expect(output).not.toContain('Start Devtools Version');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
