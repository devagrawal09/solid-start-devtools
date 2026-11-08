import { createSignal, onCleanup } from 'solid-js';
import { timelineRegistry, type Timeline } from '../../time-travel/runtime.js';

/**
 * The app's timeline, once it tracks something. The app's first
 * `createTracked` starts it, usually while a component renders, so the
 * toolbar hears about it on a microtask rather than writing during that render.
 */
export function timelineSource(): () => Timeline | undefined {
  const registry = timelineRegistry();
  const [timeline, setTimeline] = createSignal<Timeline | undefined>(registry.timeline, {
    ownedWrite: true,
  });
  const listener = () => queueMicrotask(() => setTimeline(() => registry.timeline));
  registry.listeners.add(listener);
  onCleanup(() => registry.listeners.delete(listener));
  return timeline;
}

/** The step's one-line description: its actions, else what caused it. */
export function stepLabel(step: { actions: string[]; cause?: string }): string {
  if (step.actions.length) return step.actions.join(', ');
  return step.cause ?? 'Update';
}
