---
'@solidjs/start-devtools': minor
---

Add a Timeline panel that lists what each user action re-ran, and why.

- Each click, key press or outside update is a row with its writes, re-runs and timing.
- A re-run shows the changes that caused it, down to the write that started them.
- The server-function calls an action made are listed under it, and open in the server-function panel.
- The copy button puts a report of the action on the clipboard for an agent.
