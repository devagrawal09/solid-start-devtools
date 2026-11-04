# Start Devtools

Development error and server-function tooling for Solid Start mode.

`@solidjs/start-devtools` provides the toolbar used by the Solid Vite plugin in development.

- Runtime error inspection with source-mapped stack frames.
- The issues the runtime reports, such as a signal read outside a tracking scope.
- A timeline of what each action re-ran, and why.
- What the app is loading now, and how its async loads, waits and fallbacks went.
- Server-function request and response inspection.
- A reactivity graph of the live signals, memos and effects in the app.
- An ownership tree of the components and scopes the app created.

```sh
pnpm add @solidjs/start-devtools@next
```

The toolbar is a dock at the bottom of the page. Closed, it is a small grip at the bottom
center. Click it, drag it up, or press Alt+Shift+D to open it. Drag its top edge to change
its height. It remembers whether it was open, its tab and its height across reloads, and an
error opens it on the Errors tab.

The Vite plugin mounts it automatically. Integrations can use the package directly:

```tsx
import { DevToolbar } from '@solidjs/start-devtools';

<DevToolbar>
  <App />
</DevToolbar>;
```

For custom server and client entries, render `DevToolbar` around the app in a shared
document or root component. In development, the package selects the browser or SSR build
for the current environment. In production, it becomes a children-only passthrough and
does not include the toolbar.

The same import is safe in development and production entries.

## Copy the whole session

The copy button in the dock header puts one Markdown report of everything the devtools
noticed on the clipboard, for when it is not clear which panel holds the problem.

- The three newest errors in full, with their mapped stacks and source.
- Every issue, with its count and owner.
- The five newest timeline actions, with their writes, re-runs and calls.
- The async records that were flagged, such as a wait with no pending state.
- The server calls that failed.

A section only appears when its panel has something in it. Values with sensitive names are
redacted, as in the reports of each panel.

## Demo

Two demo apps live in `examples`.

- `examples/demo` is a small orders dashboard that exercises every panel.
- `examples/explorer` is a file explorer whose component tree grows as you open folders.

```sh
pnpm demo
pnpm demo:explorer
```

## Issues

The issues panel lists what the Solid runtime reports on its diagnostics channel, such as
a signal read outside a tracking scope or a write inside a component. The console prints
the same findings, mixed with everything else.

- A finding that repeats, such as one in each row of a list, is one row with a count.
- Filter by severity (errors, warnings, info) or by code, message and owner.
- Select a row to see its kind, owner path, node and when it was seen.
- **Show in the ownership tree** and **Show in the reactivity graph** select the owner or node
  the finding is about.
- **Open the repair guide** opens the section for its code.

The panel listens from the moment the toolbar mounts, so findings from the first render
are there when you open it. Issues need a development build of `solid-js`.

## Timeline

The timeline lists what each user action made the app do. A click, a key press or an
input is one row, with the signals it wrote and every memo and effect that re-ran because
of it. An update from outside a handler, such as a timer or a promise, is a row of its own.

- A row shows the writes, the number of re-runs and how long the update took.
- Select a row for the input delay, the handler time, the time until the update settled,
  and the writes with their old and new values.
- Open a re-run to see why it ran: the changes it saw, and the changes behind each of
  those, down to the write that started them.
- A re-run marked **no change** produced the same value as before, so its work was wasted.
- The eye opens the memo or effect in the reactivity graph.
- Server-function calls the action made are listed with their status and time. Click one
  to open it in the server-function panel. A click that only calls the server still gets a
  row.
- Updates no action caused whose writes all went to unnamed signals are hidden, since most
  come from Solid's own state, such as a `<Show>` condition. The button above the list shows
  how many there are and brings them back.

The panel turns on the attribution engine of `solid-js` (`solid-js/attribution`) when the
toolbar mounts, so the first action is recorded even with the dock closed. Clicks in the
toolbar itself change nothing in the app, so they are left out. The timeline needs a
development build of `solid-js`.

## Async

The async panel shows what the app waits on.

- **Loading now** lists the async memos that are loading while the panel is open, with how
  long each has been loading and how many nodes wait on them.
- **Loads** are async memos that landed, or that a newer load replaced.
- **Waits** are writes the runtime held back until the async work they depend on settled,
  such as a click whose new screen needed data. A wait is flagged when the screen showed no
  pending state, or when it took long.
- **Fallbacks** are `<Loading>` fallbacks that showed. One shorter than 150ms is flagged as a
  flash.
- **Chains** are loads that ran one after another, each starting only when the one before
  it landed, which could often run at the same time.

Select a record for its details, the action that started it, and links to the reactivity
graph and the ownership tree. Records come from the attribution engine of `solid-js`, so a
record shows up once it has finished. The panel needs a development build of `solid-js`.

## Reactivity graph

The graph panel maps the running reactive graph. Signals, memos and effects are nodes,
and an edge points from a source to the computation that reads it. Hover a node for its
value, state and edge counts. Select one to dim the rest of the graph, list what it
reads and what reads it, and inspect its value as an expandable tree.

The panel reads the graph through the development hooks in `solid-js`, so it is empty in a
production build of the runtime. It only watches while it is open.

## Ownership tree

The ownership panel shows the app as a tree of owners.

Component mode lists components only. The scopes between them are folded into the component
above, so a component shows every signal, memo and effect created inside it. Owner mode
shows every owner instead, including roots, memos and effects.

Selecting a row lists its prop names, the signals it holds with their values, the scopes
folded into it, its children, and the ancestry it was created under. Every frame of the
ancestry is clickable, so you can walk back up the tree. Prop values are getters, so the panel lists their names
and never reads them.

A component also shows where it is declared. The location comes from the hot reload
transform, which `@solidjs/vite-plugin` runs in development, so it is there without any
extra setup. Clicking it asks the dev server to open the file in your editor.

The panel reads the tree through the development hooks in `solid-js`, so it is empty in a
production build of the runtime. It only watches while it is open.

## Copy for an agent

Each panel has a copy button that puts a Markdown report on the clipboard. Paste it into
an agent such as Claude Code, so it sees what the panel shows.

- Errors. The message, the stack mapped to the original source, and the lines of source
  around the first frames in the app. Runs of frames in dependencies are folded into one line.
- Server functions. The function, the status and time, and the headers and body of the
  request and the response. A streamed body is read for half a second.
- Ownership. The component with its declared location, owner path, prop names, signals,
  memos, effects and children.
- Reactivity. The signal, memo or effect with its state and value, what it reads, and what
  reads it.

Values with sensitive names are replaced with `[redacted]` before the report is copied.
This covers headers such as `cookie` and `authorization`, and keys, fields and signals
whose names contain words such as `password`, `token`, `secret` or `session`. Check a
report before you share it outside your machine, since a secret under another name is
copied as is.

For more inspection tools, see [Solid Devtools](https://github.com/thetarnav/solid-devtools).
