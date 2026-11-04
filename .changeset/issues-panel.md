---
'@solidjs/start-devtools': minor
---

Add an Issues panel that lists the issues the Solid runtime reports, such as a signal read outside a tracking scope. Each one is an error, a warning or info.

- Repeated findings are grouped with a count, and the tab shows the total.
- A finding links to its owner in the ownership tree, its node in the reactivity graph, and its section of the repair guide.
- The copy button puts a report of the finding on the clipboard for an agent.
