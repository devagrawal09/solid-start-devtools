import type { JSX } from '@solidjs/web';
import { createEffect, Show } from 'solid-js';
import type { Timeline } from '../../time-travel/runtime.js';
import { Text } from '../../ui/Text.js';
import './lock.css';

export interface HistoryLockProps {
  timeline: Timeline | undefined;
}

/**
 * While a past step is shown, the page is read-only: a handler would compute
 * from the shown past and write into the present. Clicks and keys outside the
 * toolbar are stopped until the panel resumes or branches.
 */
export function HistoryLock(props: HistoryLockProps): JSX.Element {
  const traveling = () => props.timeline?.traveling() ?? false;

  createEffect(traveling, (active) => {
    if (!active) return;
    const stop = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-solid-dev-toolbar]')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const types = ['keydown', 'keyup', 'keypress', 'beforeinput', 'paste', 'drop', 'submit'];
    for (const type of types) window.addEventListener(type, stop, true);
    return () => {
      for (const type of types) window.removeEventListener(type, stop, true);
    };
  });

  return (
    <Show when={traveling()}>
      <div data-solid-history-lock>
        <Text data-solid-history-lock-label options={{ size: 'xs', weight: 'semibold' }}>
          {`Viewing step ${props.timeline?.cursor()}. The page is read-only until you resume.`}
        </Text>
      </div>
    </Show>
  );
}
