import { DEV } from 'solid-js';
import { quietly } from './quiet.js';

/** The dev hooks of solid-js the toolbar uses. */
export interface DevHooksSlot {
  onOwner?: (owner: any) => void;
  onGraph?: (value: any, owner: any) => void;
  onUpdate?: () => void;
}

export type DevHooksListener = DevHooksSlot;

export interface DevHooksHub {
  /** Adds a listener. The returned function removes it. */
  listen(listener: DevHooksListener): () => void;
}

/**
 * Shares one set of dev hooks between every panel.
 *
 * Each panel used to install the hooks itself, keeping the hooks it found and
 * putting them back when it stopped. When one panel started and another stopped
 * in the same flush, the second put back hooks that no longer belonged there,
 * and the first panel stopped seeing updates.
 *
 * The hub installs once and calls every listener. It keeps calling the hooks it
 * found, so other tools sharing the slot still work, and puts them back only
 * when the last listener leaves.
 */
export function createDevHooksHub(slot: DevHooksSlot): DevHooksHub {
  const listeners = new Set<DevHooksListener>();
  let original: DevHooksSlot | undefined;

  function install(): void {
    const found: DevHooksSlot = {
      onOwner: slot.onOwner,
      onGraph: slot.onGraph,
      onUpdate: slot.onUpdate,
    };
    original = found;
    // The hooks run inside the app, often in a component body, so the
    // listeners read quietly: what they read is not the app's doing.
    slot.onOwner = (owner) => {
      found.onOwner?.(owner);
      quietly(() => {
        for (const listener of listeners) listener.onOwner?.(owner);
      });
    };
    slot.onGraph = (value, owner) => {
      found.onGraph?.(value, owner);
      quietly(() => {
        for (const listener of listeners) listener.onGraph?.(value, owner);
      });
    };
    slot.onUpdate = () => {
      found.onUpdate?.();
      quietly(() => {
        for (const listener of listeners) listener.onUpdate?.();
      });
    };
  }

  function uninstall(): void {
    if (!original) return;
    slot.onOwner = original.onOwner;
    slot.onGraph = original.onGraph;
    slot.onUpdate = original.onUpdate;
    original = undefined;
  }

  return {
    listen(listener) {
      listeners.add(listener);
      if (!original) install();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) uninstall();
      };
    },
  };
}

let shared: DevHooksHub | undefined;

/** Listens to the dev hooks of solid-js. Does nothing outside a development build. */
export function listenToDevHooks(listener: DevHooksListener): () => void {
  if (!DEV) return () => {};
  shared ??= createDevHooksHub(DEV.hooks);
  return shared.listen(listener);
}
