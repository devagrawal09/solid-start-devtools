import { describe, expect, it, vi } from 'vitest';
import {
  mountRxMap,
  readRxMapHost,
  type RxMapHost,
  shownStructureMode,
  stepStructureMode,
  structureModes,
} from './rx-map.js';

const el = {} as HTMLElement;

describe('readRxMapHost', () => {
  it('finds a host with a mount function', () => {
    const host = { graphs: [], mount: () => () => {} };
    expect(readRxMapHost({ __RX__: host })).toBe(host);
  });

  it('ignores a missing host, or one without mount', () => {
    expect(readRxMapHost({})).toBeUndefined();
    expect(readRxMapHost({ __RX__: null })).toBeUndefined();
    expect(readRxMapHost({ __RX__: { graphs: [] } })).toBeUndefined();
    expect(readRxMapHost({ __RX__: { mount: 'no' } })).toBeUndefined();
  });

  it('ignores a getter that throws', () => {
    const scope = {
      get __RX__() {
        throw new Error('blocked');
      },
    };
    expect(readRxMapHost(scope)).toBeUndefined();
  });
});

describe('structure modes', () => {
  it('offers Map only when the app has a map', () => {
    expect(structureModes(false)).toEqual(['owners', 'graph']);
    expect(structureModes(true)).toEqual(['owners', 'graph', 'map']);
  });

  it('shows Owners for a saved Map mode when the app has no map', () => {
    expect(shownStructureMode('map', false)).toBe('owners');
    expect(shownStructureMode('map', true)).toBe('map');
    expect(shownStructureMode('graph', false)).toBe('graph');
  });

  it('steps through the modes it offers, wrapping around', () => {
    const modes = structureModes(true);
    expect(stepStructureMode(modes, 'graph', 1)).toBe('map');
    expect(stepStructureMode(modes, 'map', 1)).toBe('owners');
    expect(stepStructureMode(modes, 'owners', -1)).toBe('map');
    expect(stepStructureMode(structureModes(false), 'graph', 1)).toBe('owners');
  });
});

describe('mountRxMap', () => {
  it('mounts into the element and disposes once', () => {
    const dispose = vi.fn();
    const host: RxMapHost = { mount: vi.fn(() => dispose) };
    const unmount = mountRxMap(host, el);
    expect(host.mount).toHaveBeenCalledWith(el);
    expect(dispose).not.toHaveBeenCalled();
    unmount();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('survives a map that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: RxMapHost = {
      mount: () => {
        throw new Error('no map');
      },
    };
    expect(() => mountRxMap(failing, el)()).not.toThrow();
    const throwing: RxMapHost = {
      mount: () => () => {
        throw new Error('no dispose');
      },
    };
    expect(() => mountRxMap(throwing, el)()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
