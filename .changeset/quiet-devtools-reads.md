---
'@solidjs/start-devtools': patch
---

The devtools' own reads of the app no longer fill the Health view with `STRICT_READ_UNTRACKED` warnings about `_flags`, `_time`, `_subs` and `_config`. The graph and the tree read node fields, and on a store those reads went through its proxy. Inside a strict-read scope of the app, such as an effect callback, the runtime reported each one as the app's. The devtools now read the app untracked, and Health leaves out anything the runtime reports while they do.
