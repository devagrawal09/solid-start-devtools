import { getTimeline, track, type Step, type Timeline } from './runtime.js';
import type { CreateTracked } from './types.js';

export type { CreateTracked, Step, Timeline };

export const createTracked: CreateTracked = (create: (...args: any[]) => any, ...args: any[]) =>
  track(create, args);

export { getTimeline };
