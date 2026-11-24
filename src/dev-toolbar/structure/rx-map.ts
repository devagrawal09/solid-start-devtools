/**
 * The ReactiveScript map. An app compiled from `.rx` files can register a live
 * map of its reactive graph on `globalThis.__RX__` in development. The toolbar
 * only hosts it: it never imports a ReactiveScript package.
 */

/** What the app puts on `globalThis.__RX__`. The toolbar only calls `mount`. */
export interface RxMapHost {
  /** Puts the map into `el` and returns a function that takes it out again. */
  mount(el: HTMLElement): () => void;
}

export type StructureMode = 'owners' | 'graph' | 'map';

/** The map host the app registered, or undefined when it has none. */
export function readRxMapHost(scope: object = globalThis): RxMapHost | undefined {
  let host: unknown;
  try {
    host = Reflect.get(scope, '__RX__');
  } catch {
    // A getter another script put there can throw.
    return undefined;
  }
  if (!host || typeof host !== 'object') return undefined;
  return typeof (host as { mount?: unknown }).mount === 'function'
    ? (host as RxMapHost)
    : undefined;
}

/** The modes the Structure view offers. Map is there only when the app has a map. */
export function structureModes(hasMap: boolean): StructureMode[] {
  return hasMap ? ['owners', 'graph', 'map'] : ['owners', 'graph'];
}

/** The mode the view shows. A Map mode saved by an earlier load falls back to Owners. */
export function shownStructureMode(mode: StructureMode, hasMap: boolean): StructureMode {
  return structureModes(hasMap).includes(mode) ? mode : 'owners';
}

/** The mode after `mode` in `modes`, wrapping around. A negative step goes back. */
export function stepStructureMode(
  modes: StructureMode[],
  mode: StructureMode,
  step: 1 | -1,
): StructureMode {
  const index = modes.indexOf(mode);
  if (index === -1) return modes[0];
  return modes[(index + step + modes.length) % modes.length];
}

/**
 * Mounts the map into `el`. The function it returns takes the map out once,
 * however often it is called. A map that fails to mount is reported and leaves
 * the toolbar alone.
 */
export function mountRxMap(host: RxMapHost, el: HTMLElement): () => void {
  let dispose: (() => void) | undefined;
  try {
    const result = host.mount(el);
    if (typeof result === 'function') dispose = result;
  } catch (error) {
    console.warn('[solid dev toolbar] failed to mount the ReactiveScript map', error);
  }
  return () => {
    const current = dispose;
    dispose = undefined;
    if (!current) return;
    try {
      current();
    } catch (error) {
      console.warn('[solid dev toolbar] failed to unmount the ReactiveScript map', error);
    }
  };
}
