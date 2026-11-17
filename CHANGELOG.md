# @solidjs/start-devtools

## 1.0.0

### Major Changes

- ec71b6a: Add the Start development toolbar, runtime error overlay, and server-function inspector.

### Minor Changes

- d99ff2c: Add an Async panel that shows what the app is loading now, and how its async loads, waits and fallbacks went.

  - Loads that a newer load replaced, waits with no pending state on screen, fallbacks that flashed, and loads that ran one after another are flagged.
  - A record shows the action that started it and links to the reactivity graph and the ownership tree.
  - The copy button puts a report of the record on the clipboard for an agent.

- 3dc8d28: Each panel has a button that copies a Markdown report for an agent such as Claude Code.

  - The error report has the message, the mapped stack and the source around the frames in the app.
  - The server function report has the status, time, headers and bodies of the call.
  - The ownership and reactivity reports have the selected node with its values and the nodes around it.
  - Values with sensitive names, such as `cookie`, `token` or `password`, are redacted.

- a7dedf8: Add `connectDevServer`, which lets `@solidjs/vite-plugin` send the toolbar what only the dev server knows, and `@solidjs/start-devtools/protocol`, the messages and endpoints both sides use.

  - Errors the server runtime reports during a render, a server function or a request show in the Health view.
  - Open in editor sends one request to the plugin's endpoint, which resolves the path against the Vite root.
  - The solid-js version in the header comes from the dev server when the page cannot import the package file.

- a57fe91: Show the devtools in a dock at the bottom of the page.

  - Closed, the dock is a small grip at the bottom center of the page. It grows into a pull tab on hover or focus, and turns red when there are errors. Click it, or drag it up, to open the dock.
  - Alt+Shift+D opens and closes the dock.
  - Drag the top edge of the dock to change its height. The page can scroll past it.
  - A side nav holds the Errors, Server functions, Reactivity and Ownership tabs, with counts of errors and calls.
  - The header shows the version and the current route.
  - The dock remembers whether it was open, its tab and its height across reloads.
  - An error opens the dock on the Errors tab.
  - Selected tabs, calls and stack frames use a rounded fill instead of a colored left border. Graph nodes show their kind with a colored dot and tint instead of a left border.

- dba6dfe: - The dock has three views in its header: Health, Activity and Structure. The header shows the `solid-js` version the app runs, in place of the toolbar's title and version.
  - Health lists thrown errors and runtime issues together, with search and severity chips. An error shows the function it was thrown in, when it was caught, the action it was caught during with a link to it, its stack frames beside the source, and "Open in editor".
  - Activity merges actions, server-function calls, async loads and waits, and errors into one stream over the last 30 seconds, with a live lanes strip on a time axis, filter chips, time groups and a pause button. Repeated actions fold into one row. An action shows what it wrote, what re-ran and which effects ran, then waterfalls of its re-runs and server calls.
  - Structure shows the ownership tree or the reactivity graph. Tree rows show signal and memo counts and how recently and how often their computations update. "Hide Solid internals" folds Solid's own components away. The detail lists props, signals and memos by kind, with a signal's previous value.
  - ⌘K (Ctrl+K) opens a search across components, signals, memos, actions and server functions while the dock is open.
  - The timeline and the async history keep everything from the last 30 seconds instead of a fixed number of entries, so a loop such as an animation frame no longer pushes other actions out. A fast run of one action draws as one bar.
  - Every list and detail split is resizable.
- 47f4e1e: Add interactive Element Inspector and cross-panel component funneling:

  - Press `Alt+Shift+C` or click the crosshair icon in the dock header to inspect DOM elements.
  - Hovering elements shows an overlay with the component name, file location, and dimensions.
  - Clicking an element selects the component and funnels relevant data across devtool panels without interrupting your active view.
  - Reactivity graph filters to reactive signals, memos, and computations owned by the selected component instance.
  - Ownership tree automatically expands, scrolls to, and highlights the selected component.
  - The funnel badge in the dock header provides quick navigation to the Ownership tree, direct "See in editor" launch, and 1-click filter clearing.

- 0562bea: Add fine-grained reactive update highlighter with frequency color progression:

  - Toggle via `Alt+Shift+H` shortcut or the highlight icon in the dock toolbar, with state persisted in local storage.
  - Outlines each DOM change as it happens. A text change gets a box around the changed text only, one per line it covers. Other changes get a box around the element.
  - Frequency-based color progression within an 800ms window: Light Blue (1), Purple (2-3), Pink (4-7), and Red (8+).
  - The boxes are drawn on one canvas in a shadow root, so they add nothing to the page and page styles cannot reach them. They follow the page when it scrolls. One frame draws at most 200 of them, and the fade turns off when the user prefers reduced motion.

- 2b8a936: Add an Issues panel that lists the issues the Solid runtime reports, such as a signal read outside a tracking scope. Each one is an error, a warning or info.

  - Repeated findings are grouped with a count, and the tab shows the total.
  - A finding links to its owner in the ownership tree, its node in the reactivity graph, and its section of the repair guide.
  - The copy button puts a report of the finding on the clipboard for an agent.

- 52dc743: Add live state and store editing to the dev toolbar.

  Signals and stores can now be inspected and edited live on-the-fly directly from the devtools:

  - In the Reactivity Graph detail pane, primitive values and nested properties of selected signals and store slots can be edited inline.
  - In the Ownership Tree detail pane, component signals feature inline editing with immediate updates to dependent memos, effects, and DOM elements.
  - Boolean values support 1-click toggling, while strings, numbers, null, undefined, and JSON objects/arrays are parsed and written through Solid's internal reactivity scheduler.
  - Values inside a `Map`, a `Set`, a typed array or a class instance are shown but not editable. An edit the app does not take is marked in the panel.

- ed9f773: Make the detail panes in the Ownership and Reactivity panels resizable. Drag the left edge of a pane, or focus it and press the left and right arrow keys. Each pane keeps its own width across reloads, and a double-click on the edge resets it.
- c6402b7: The dock header has a button that copies one report of the whole session for an agent: the newest errors, the issues, the recent timeline actions, the flagged async records and the failed server calls.
- 588365e: Add a Timeline panel that lists what each user action re-ran, and why.

  - Each click, key press or outside update is a row with its writes, re-runs and timing.
  - A re-run shows the changes that caused it, down to the write that started them.
  - The server-function calls an action made are listed under it, and open in the server-function panel.
  - The copy button puts a report of the action on the clipboard for an agent.

### Patch Changes

- 368b4c9: The toolbar keeps the 200 newest errors, so an error thrown in a loop no longer grows the list without end.
- 34d3748: Keep server-function inspector entries reactive as responses arrive.
- 62df134: The reactivity graph lays out each group of connected nodes in a band of its own, so unrelated chains no longer share columns.

  - Nodes with no edges share a grid under the bands instead of one tall column.
  - An edge that skips columns runs in a lane of its own instead of through other nodes.
  - A signal sits in the column right before the node that reads it.
  - A band keeps its arrangement while its nodes and edges stay the same. A band whose structure changed is arranged again, so its edges cross as little as possible.

- 212dad4: Errors thrown by browser extensions' scripts in the page are no longer listed as the app's errors.
- d66c2ed: The Ownership tree rows and the Reactivity graph nodes and edges are now matched by id between refreshes. Before, every refresh rebuilt all of them, so an app that writes a signal every frame kept the page at about 15 to 20 frames per second while one of these panels was open.
- 7783dd5: Build with Rolldown, update the project toolchain, and strengthen package validation.
- 550ba8e: Build with the native Solid compiler and migrate formatting to Oxfmt.
- 341960b: Add an ownership tree panel to the dev toolbar.

  The panel shows the app as a tree of owners. Component mode lists components only and folds the scopes between them into the component above, so a component shows the signals, memos and effects created inside it. Owner mode shows every owner.
  Selecting a row lists its prop names, the signals it holds with their values, the scopes folded into it, its children, and the ancestry it was created under.
  Components show where they are declared, and clicking the location opens the file in your editor.
  Rows flash when an owner is created, and the tree can be searched by component, scope or signal.

- 4df6fae: Support server rendering the development error boundary and avoid duplicate toolbars when authored entries wrap their app.
- 841fc15: The server-function panel is driven by the runtime's `"call"` record.

  `observeServerFunctionCalls` was removed from `@solidjs/web/server-functions` in rc.9; the panel has shown nothing since. It now subscribes to `OBSERVE.records` for `"request"` and `"call"` with `bodies: true`: a call appears the moment its request is handed to `fetch` and completes when the caller's await settles, showing the request as sent and the response as it arrived, with unread bodies to inspect, the function's source name when the build carried one, and the call's timing. A call whose fetch itself failed is marked as failed, with the thrown value's message in place of the response.

  The toolbar excludes its own owner from the runtime's observe layer (`OBSERVE.exclude`) and hands the app it wraps back (`OBSERVE.include`), so the toolbar's own signals and effects are never reported as the app's by diagnostics, attribution, or the performance tracks.

- 841fc15: Build and read the Solid 2.0.0-rc.13 runtime.

  The toolbar is compiled with `@solidjs/compiler`, the compiler that ships with the runtime, so delegated event handlers use the key the runtime reads (`_$$click`). Every click in the reactivity and ownership panels was dead against rc.9 and later.
  The `solid-js` and `@solidjs/web` peers move to `^2.0.0-rc.13`.
  The reactivity graph reads a node's error off its extension (`_x._error`), recognises store slot nodes by the store they belong to, and hides the memo the built-in hot reload wrapper creates, which the runtime now marks as plumbing instead of naming. The ownership tree walks through that memo without a row.
  A server render that fails sets the 500 status and logs, without writing toolbar state.

- b1177e3: Add a reactivity graph panel to the dev toolbar.

  The panel maps live signals, memos and effects as a directed graph.
  Hovering a node shows its value, state, owner and edge counts.
  Selecting a node highlights everything upstream and downstream of it and lists its sources and observers.
  The selected node's value is shown as an expandable tree, the same one the server function panel uses for serialized values.
  Nodes pulse and count changes as the app updates, and the graph can be filtered by kind or searched by name, value or owner.

- fd65515: Show the body of server function calls that send files.

  With `enableRichArguments()` in `@solidjs/web` 2.0.0-rc.20, a call whose arguments hold a `File` or `Blob` sends multipart form data marked `X-Server-Function-Format: 0`. The panel read that body as a seroval stream and showed no body. It now shows the arguments in the seroval tree and the files in a form data table. Reports copied for an agent list both.

- f7dd9d0: Make direct imports production-safe with a no-op default export and development-only browser and server implementations. Register server-function observers from the browser entry.
- 01fe072: Require the stable Solid 2.0 release. The peer ranges for `solid-js` and `@solidjs/web` are now `^2.0.0` instead of `^2.0.0-rc.13`, so release candidates no longer satisfy them.
- cb0e333: Update terracotta to `2.0.0-next.9`.
- a3cb04d: Sync the dev toolbar redesign from Solid Start: panel layout with a call list beside a detail pane, collapsible sections, body-first content viewers, request timing, unhandled rejection capture, drag limited to the toolbar pill, and source map tracing through `@jridgewell/trace-mapping`. Stack parsing moves from `error-stack-parser` to `error-stack-parser-es/lite`, dropping the `stackframe` transitive dependency.
- 5754ae3: Fix three toolbar UI bugs.

  - A hovered button no longer covers the focus ring of the button next to it.
  - Arrows in the reactivity graph line up with their connection lines and follow the connection's state.
  - Dragging the toolbar no longer clicks the button the drag started on.

- d086474: Highlight error sources with twinkleplop instead of shiki.

  The code view now highlights synchronously, so a stack frame's source appears with the panel rather than a moment later, and the toolbar no longer ships a WebAssembly grammar engine. The built package drops from 8.1 MB to 3.6 MB, and the error viewer chunk from 1.1 MB to 273 kB.
  The panel highlights the whole file and keeps twenty-five lines on each side of the frame, which is about as far as the view scrolls. Cutting the file before highlighting it left the highlighter reading a block comment or template literal it never saw open, and the colours fell apart from there. The view opens on the frame's line.
  The frame's line is marked with the `focus` directive and the word it points at with `err`, both written as comments above the file. The code itself is never edited to carry them, and marker lines are dropped from the output.

## 1.0.0-next.9

### Minor Changes

- d99ff2c: Add an Async panel that shows what the app is loading now, and how its async loads, waits and fallbacks went.

  - Loads that a newer load replaced, waits with no pending state on screen, fallbacks that flashed, and loads that ran one after another are flagged.
  - A record shows the action that started it and links to the reactivity graph and the ownership tree.
  - The copy button puts a report of the record on the clipboard for an agent.

- a7dedf8: Add `connectDevServer`, which lets `@solidjs/vite-plugin` send the toolbar what only the dev server knows, and `@solidjs/start-devtools/protocol`, the messages and endpoints both sides use.

  - Errors the server runtime reports during a render, a server function or a request show in the Health view.
  - Open in editor sends one request to the plugin's endpoint, which resolves the path against the Vite root.
  - The solid-js version in the header comes from the dev server when the page cannot import the package file.

- dba6dfe: - The dock has three views in its header: Health, Activity and Structure. The header shows the `solid-js` version the app runs, in place of the toolbar's title and version.
  - Health lists thrown errors and runtime issues together, with search and severity chips. An error shows the function it was thrown in, when it was caught, the action it was caught during with a link to it, its stack frames beside the source, and "Open in editor".
  - Activity merges actions, server-function calls, async loads and waits, and errors into one stream over the last 30 seconds, with a live lanes strip on a time axis, filter chips, time groups and a pause button. Repeated actions fold into one row. An action shows what it wrote, what re-ran and which effects ran, then waterfalls of its re-runs and server calls.
  - Structure shows the ownership tree or the reactivity graph. Tree rows show signal and memo counts and how recently and how often their computations update. "Hide Solid internals" folds Solid's own components away. The detail lists props, signals and memos by kind, with a signal's previous value.
  - ⌘K (Ctrl+K) opens a search across components, signals, memos, actions and server functions while the dock is open.
  - The timeline and the async history keep everything from the last 30 seconds instead of a fixed number of entries, so a loop such as an animation frame no longer pushes other actions out. A fast run of one action draws as one bar.
  - Every list and detail split is resizable.
- 2b8a936: Add an Issues panel that lists the issues the Solid runtime reports, such as a signal read outside a tracking scope. Each one is an error, a warning or info.

  - Repeated findings are grouped with a count, and the tab shows the total.
  - A finding links to its owner in the ownership tree, its node in the reactivity graph, and its section of the repair guide.
  - The copy button puts a report of the finding on the clipboard for an agent.

- 52dc743: Add live state and store editing to the dev toolbar.

  Signals and stores can now be inspected and edited live on-the-fly directly from the devtools:

  - In the Reactivity Graph detail pane, primitive values and nested properties of selected signals and store slots can be edited inline.
  - In the Ownership Tree detail pane, component signals feature inline editing with immediate updates to dependent memos, effects, and DOM elements.
  - Boolean values support 1-click toggling, while strings, numbers, null, undefined, and JSON objects/arrays are parsed and written through Solid's internal reactivity scheduler.
  - Values inside a `Map`, a `Set`, a typed array or a class instance are shown but not editable. An edit the app does not take is marked in the panel.

- ed9f773: Make the detail panes in the Ownership and Reactivity panels resizable. Drag the left edge of a pane, or focus it and press the left and right arrow keys. Each pane keeps its own width across reloads, and a double-click on the edge resets it.
- c6402b7: The dock header has a button that copies one report of the whole session for an agent: the newest errors, the issues, the recent timeline actions, the flagged async records and the failed server calls.
- 588365e: Add a Timeline panel that lists what each user action re-ran, and why.

  - Each click, key press or outside update is a row with its writes, re-runs and timing.
  - A re-run shows the changes that caused it, down to the write that started them.
  - The server-function calls an action made are listed under it, and open in the server-function panel.
  - The copy button puts a report of the action on the clipboard for an agent.

### Patch Changes

- 368b4c9: The toolbar keeps the 200 newest errors, so an error thrown in a loop no longer grows the list without end.
- 62df134: The reactivity graph lays out each group of connected nodes in a band of its own, so unrelated chains no longer share columns.

  - Nodes with no edges share a grid under the bands instead of one tall column.
  - An edge that skips columns runs in a lane of its own instead of through other nodes.
  - A signal sits in the column right before the node that reads it.
  - A band keeps its arrangement while its nodes and edges stay the same. A band whose structure changed is arranged again, so its edges cross as little as possible.

- 212dad4: Errors thrown by browser extensions' scripts in the page are no longer listed as the app's errors.
- fd65515: Show the body of server function calls that send files.

  With `enableRichArguments()` in `@solidjs/web` 2.0.0-rc.20, a call whose arguments hold a `File` or `Blob` sends multipart form data marked `X-Server-Function-Format: 0`. The panel read that body as a seroval stream and showed no body. It now shows the arguments in the seroval tree and the files in a form data table. Reports copied for an agent list both.

## 1.0.0-next.8

### Minor Changes

- 47f4e1e: Add interactive Element Inspector and cross-panel component funneling:

  - Press `Alt+Shift+C` or click the crosshair icon in the dock header to inspect DOM elements.
  - Hovering elements shows an overlay with the component name, file location, and dimensions.
  - Clicking an element selects the component and funnels relevant data across devtool panels without interrupting your active view.
  - Reactivity graph filters to reactive signals, memos, and computations owned by the selected component instance.
  - Ownership tree automatically expands, scrolls to, and highlights the selected component.
  - The funnel badge in the dock header provides quick navigation to the Ownership tree, direct "See in editor" launch, and 1-click filter clearing.

- 0562bea: Add fine-grained reactive update highlighter with frequency color progression:

  - Toggle via `Alt+Shift+H` shortcut or the highlight icon in the dock toolbar, with state persisted in local storage.
  - Outlines each DOM change as it happens. A text change gets a box around the changed text only, one per line it covers. Other changes get a box around the element.
  - Frequency-based color progression within an 800ms window: Light Blue (1), Purple (2-3), Pink (4-7), and Red (8+).
  - The boxes are drawn on one canvas in a shadow root, so they add nothing to the page and page styles cannot reach them. They follow the page when it scrolls. One frame draws at most 200 of them, and the fade turns off when the user prefers reduced motion.

### Patch Changes

- d66c2ed: The Ownership tree rows and the Reactivity graph nodes and edges are now matched by id between refreshes. Before, every refresh rebuilt all of them, so an app that writes a signal every frame kept the page at about 15 to 20 frames per second while one of these panels was open.

## 1.0.0-next.7

### Minor Changes

- 3dc8d28: Each panel has a button that copies a Markdown report for an agent such as Claude Code.

  - The error report has the message, the mapped stack and the source around the frames in the app.
  - The server function report has the status, time, headers and bodies of the call.
  - The ownership and reactivity reports have the selected node with its values and the nodes around it.
  - Values with sensitive names, such as `cookie`, `token` or `password`, are redacted.

- a57fe91: Show the devtools in a dock at the bottom of the page.

  - Closed, the dock is a small grip at the bottom center of the page. It grows into a pull tab on hover or focus, and turns red when there are errors. Click it, or drag it up, to open the dock.
  - Alt+Shift+D opens and closes the dock.
  - Drag the top edge of the dock to change its height. The page can scroll past it.
  - A side nav holds the Errors, Server functions, Reactivity and Ownership tabs, with counts of errors and calls.
  - The header shows the version and the current route.
  - The dock remembers whether it was open, its tab and its height across reloads.
  - An error opens the dock on the Errors tab.
  - Selected tabs, calls and stack frames use a rounded fill instead of a colored left border. Graph nodes show their kind with a colored dot and tint instead of a left border.

## 1.0.0-next.6

### Patch Changes

- 5754ae3: Fix three toolbar UI bugs.

  - A hovered button no longer covers the focus ring of the button next to it.
  - Arrows in the reactivity graph line up with their connection lines and follow the connection's state.
  - Dragging the toolbar no longer clicks the button the drag started on.

## 1.0.0-next.5

### Patch Changes

- 341960b: Add an ownership tree panel to the dev toolbar.

  The panel shows the app as a tree of owners. Component mode lists components only and folds the scopes between them into the component above, so a component shows the signals, memos and effects created inside it. Owner mode shows every owner.
  Selecting a row lists its prop names, the signals it holds with their values, the scopes folded into it, its children, and the ancestry it was created under.
  Components show where they are declared, and clicking the location opens the file in your editor.
  Rows flash when an owner is created, and the tree can be searched by component, scope or signal.

- 841fc15: The server-function panel is driven by the runtime's `"call"` record.

  `observeServerFunctionCalls` was removed from `@solidjs/web/server-functions` in rc.9; the panel has shown nothing since. It now subscribes to `OBSERVE.records` for `"request"` and `"call"` with `bodies: true`: a call appears the moment its request is handed to `fetch` and completes when the caller's await settles, showing the request as sent and the response as it arrived, with unread bodies to inspect, the function's source name when the build carried one, and the call's timing. A call whose fetch itself failed is marked as failed, with the thrown value's message in place of the response.

  The toolbar excludes its own owner from the runtime's observe layer (`OBSERVE.exclude`) and hands the app it wraps back (`OBSERVE.include`), so the toolbar's own signals and effects are never reported as the app's by diagnostics, attribution, or the performance tracks.

- 841fc15: Build and read the Solid 2.0.0-rc.13 runtime.

  The toolbar is compiled with `@solidjs/compiler`, the compiler that ships with the runtime, so delegated event handlers use the key the runtime reads (`_$$click`). Every click in the reactivity and ownership panels was dead against rc.9 and later.
  The `solid-js` and `@solidjs/web` peers move to `^2.0.0-rc.13`.
  The reactivity graph reads a node's error off its extension (`_x._error`), recognises store slot nodes by the store they belong to, and hides the memo the built-in hot reload wrapper creates, which the runtime now marks as plumbing instead of naming. The ownership tree walks through that memo without a row.
  A server render that fails sets the 500 status and logs, without writing toolbar state.

- b1177e3: Add a reactivity graph panel to the dev toolbar.

  The panel maps live signals, memos and effects as a directed graph.
  Hovering a node shows its value, state, owner and edge counts.
  Selecting a node highlights everything upstream and downstream of it and lists its sources and observers.
  The selected node's value is shown as an expandable tree, the same one the server function panel uses for serialized values.
  Nodes pulse and count changes as the app updates, and the graph can be filtered by kind or searched by name, value or owner.

- cb0e333: Update terracotta to `2.0.0-next.9`.
- d086474: Highlight error sources with twinkleplop instead of shiki.

  The code view now highlights synchronously, so a stack frame's source appears with the panel rather than a moment later, and the toolbar no longer ships a WebAssembly grammar engine. The built package drops from 8.1 MB to 3.6 MB, and the error viewer chunk from 1.1 MB to 273 kB.
  The panel highlights the whole file and keeps twenty-five lines on each side of the frame, which is about as far as the view scrolls. Cutting the file before highlighting it left the highlighter reading a block comment or template literal it never saw open, and the colours fell apart from there. The view opens on the frame's line.
  The frame's line is marked with the `focus` directive and the word it points at with `err`, both written as comments above the file. The code itself is never edited to carry them, and marker lines are dropped from the output.

## 1.0.0-next.4

### Patch Changes

- a3cb04d: Sync the dev toolbar redesign from Solid Start: panel layout with a call list beside a detail pane, collapsible sections, body-first content viewers, request timing, unhandled rejection capture, drag limited to the toolbar pill, and source map tracing through `@jridgewell/trace-mapping`. Stack parsing moves from `error-stack-parser` to `error-stack-parser-es/lite`, dropping the `stackframe` transitive dependency.

## 1.0.0-next.3

### Patch Changes

- 34d3748: Keep server-function inspector entries reactive as responses arrive.

## 1.0.0-next.2

### Patch Changes

- 7783dd5: Build with Rolldown, update the project toolchain, and strengthen package validation.
- 550ba8e: Build with the native Solid compiler and migrate formatting to Oxfmt.
- f7dd9d0: Make direct imports production-safe with a no-op default export and development-only browser and server implementations. Register server-function observers from the browser entry.

## 1.0.0-next.1

### Patch Changes

- 4df6fae: Support server rendering the development error boundary and avoid duplicate toolbars when authored entries wrap their app.

## 1.0.0-next.0

### Major Changes

- ec71b6a: Add the Start development toolbar, runtime error overlay, and server-function inspector.
