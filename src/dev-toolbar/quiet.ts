import { untrack } from 'solid-js';

/**
 * The devtools read the app's runtime nodes field by field, such as `_flags`
 * and `_time`. A store hands out proxies, and the runtime lists them beside
 * plain signals, so the same field reads go through the store's proxy. In a
 * strict-read scope, such as an effect callback of the app, the runtime then
 * reports `STRICT_READ_UNTRACKED` for every field, as if the app had read it.
 *
 * `untrack` is the runtime's own way to mark a deliberate one-time read: it
 * closes the strict-read window. While it runs, the toolbar also leaves out
 * whatever the runtime reports, so the Health view never counts findings the
 * devtools caused.
 */
let depth = 0;

/** Runs a devtools read of the app untracked, with its findings left out of Health. */
export function quietly<T>(read: () => T): T {
  depth++;
  try {
    return untrack(read);
  } finally {
    depth--;
  }
}

/** Whether a devtools read is running now. */
export function isQuiet(): boolean {
  return depth > 0;
}
