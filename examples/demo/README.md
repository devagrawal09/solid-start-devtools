# Dev toolbar demo

A small orders dashboard that exercises every panel of the toolbar.

```sh
pnpm demo
```

The command builds the package and starts the app on http://localhost:5173.

## What it shows

The app is built with `@solidjs/vite-plugin` in start mode, so the plugin owns the entries
and mounts the toolbar itself. `examples/demo/src/App.tsx` is the whole app.

- The reactivity graph has named nodes. `orders`, `query`, `status-filter`, `sort-order`
  and `currency` are signals. `matching-orders`, `sorted-orders`, `revenue`, `open-orders`,
  `average-order`, `exchange-rate` and `converted-revenue` are memos. `sync-title` is an
  effect that writes the document title.
- `exchange-rate` is an async memo backed by a `"use server"` function. While it is in
  flight, it and `converted-revenue` read as pending in the graph.
- The server function panel lists the same call with its request and response bodies.
- The error panel catches the error behind the "Throw an error" button, with a
  source-mapped stack frame.
- `orders`, `query`, `status-filter`, `sort-order` and `currency` are created with
  `createTracked`, so the History panel records each update to them and can show the app
  as it was after any of them. This needs a solid-js whose `flush` record reports
  `changes`; with an older one the panel says so.

## Things to try

1. Open the graph and select `revenue`. Everything it reads turns blue and everything that
   reads it turns green.
2. Type in the search box and watch `matching-orders` and the nodes after it count changes.
3. Switch the currency and open the graph quickly to catch the pending state.
4. Turn the `Render` filter off to hide the nodes the JSX compiler creates.
