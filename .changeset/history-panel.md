---
'@solidjs/start-devtools': minor
---

Add a History panel and `createTracked` from `@solidjs/start-devtools/time-travel`, to see and rewind how tracked state changed.

- `createTracked(createSignal, 0, { name: 'count' })` returns what the primitive returns. It works with `createSignal`, `createOptimistic`, `createMemo`, `createStore`, `createOptimisticStore` and `createProjection`, and is the primitive itself in production and on the server.
- Each update that changed tracked state is one row, labelled with the action or interaction behind it. An action's held writes are listed when they land, and an optimistic value when it appears and when it lifts.
- Selecting a row shows the app as it was after that update without writing to its state. The page is read-only until Resume; Branch here makes the shown update the present.
- Needs a solid-js whose `flush` record reports `changes`. With an older one the panel says so and `createTracked` returns plain primitives.
