import type { Step, Timeline } from './runtime.js';
import type { CreateTracked } from './types.js';

export type { CreateTracked, Step, Timeline };

/** In production, the primitive itself. */
export const createTracked: CreateTracked = (create: (...args: any[]) => any, ...args: any[]) =>
  create(...args);

export function getTimeline(): Timeline | undefined {
  return undefined;
}
