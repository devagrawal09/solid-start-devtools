---
'@solidjs/start-devtools': minor
---

The Structure view hosts the live map of a ReactiveScript app. When the app sets `globalThis.__RX__` with a `mount(element)` function, as `@reactivescript/map/live` does in development, a third chip, Map, mounts the map into the view and disposes it when you leave Map or close the dock. Without a map, the chip is not there, and a remembered Map falls back to Owners.
