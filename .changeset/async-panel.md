---
'@solidjs/start-devtools': minor
---

Add an Async panel that shows what the app is loading now, and how its async loads, waits and fallbacks went.

- Loads that a newer load replaced, waits with no pending state on screen, fallbacks that flashed, and loads that ran one after another are flagged.
- A record shows the action that started it and links to the reactivity graph and the ownership tree.
- The copy button puts a report of the record on the clipboard for an agent.
