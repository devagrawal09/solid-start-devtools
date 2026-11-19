---
'@solidjs/start-devtools': patch
---

The toolbar no longer freezes the tab when an action calls a server function and then refreshes a load (solidjs/solid#5038). The timeline and async panels wrote their list back after every flush record, even when it had not changed. While the action held that write, each rewrite flushed again, so the page never went idle. They now write only a new list.
