import type { ChangeRecord } from 'solid-js/attribution';
import type { TimelineEntry, TimelineRun } from '../timeline/tracker.js';
import { code } from './markdown.js';
import { isSensitiveName, REDACTED, redactText, redactUrl } from './redact.js';

export interface TimelineReportInput {
  entry: TimelineEntry;
  /** The path and query of the page. */
  route: string;
}

/** Most re-runs the report lists. The rest are counted. */
const MAX_REPORT_RUNS = 50;

/**
 * A duration for reading. Browsers round the clock to 0.1ms or coarser, so a
 * shorter run reads as under that instead of as zero.
 */
export function ms(value: number | undefined): string {
  if (value === undefined) return '?';
  if (value < 0.1) return '<0.1ms';
  return value < 1 ? `${value.toFixed(2)}ms` : `${value.toFixed(1)}ms`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** `count` 0 → 1, with the values hidden when the name looks sensitive. */
export function changeText(change: ChangeRecord): string {
  const name = code(change.name);
  if (change.kind !== 'write') return `${change.kind} ${name}`;
  if (change.value === undefined) return `write ${name}`;
  if (isSensitiveName(change.name)) return `write ${name} ${REDACTED}`;
  const prev = change.prev === undefined ? '' : `${redactText(change.prev)} → `;
  return `write ${name} ${prev}${redactText(change.value)}`;
}

/** The changes that made a run happen, nearest first, each with what caused it. */
export function causeLines(causes: ChangeRecord[], depth = 0): string[] {
  const out: string[] = [];
  for (const cause of causes) {
    const text = cause.kind === 'derived' ? `${code(cause.name)} changed` : changeText(cause);
    out.push(`${'  '.repeat(depth)}- ← ${text}`);
    if (cause.causes?.length) out.push(...causeLines(cause.causes, depth + 1));
  }
  return out;
}

function runLine(run: TimelineRun): string {
  const { event } = run;
  const notes: string[] = [ms(event.selfMs)];
  if (run.effectMs !== undefined) notes.push(`callback ${ms(run.effectMs)}`);
  if (!event.changed) notes.push('no change');
  if (event.phase !== 'plain') notes.push(event.phase);
  if (event.depsAdded.length) notes.push(`now reads ${event.depsAdded.map(code).join(', ')}`);
  if (event.depsRemoved.length)
    notes.push(`stopped reading ${event.depsRemoved.map(code).join(', ')}`);
  return `- ${event.nodeKind} ${code(event.nodeName)} (${notes.join(', ')})`;
}

/** A Markdown report of what one action made the app do, for an agent to read. */
export function timelineReport(input: TimelineReportInput): string {
  const { entry } = input;
  const { interaction } = entry;
  const out: string[] = [`# Solid update: ${code(entry.label)}`, ''];

  out.push(`- Page: ${code(redactUrl(input.route))}`);
  if (interaction) {
    out.push(`- Outcome: ${interaction.outcome ?? 'pending'}`);
    if (interaction.inputDelayMs !== undefined) {
      out.push(`- Input delay: ${ms(interaction.inputDelayMs)}`);
    }
    out.push(`- Handler: ${ms(interaction.handlerMs)}`);
    if (interaction.continuationMs !== undefined) {
      out.push(`- Async handler continued for ${ms(interaction.continuationMs)}`);
    }
    out.push(`- Re-runs: ${interaction.runs}, ${ms(interaction.runMs)} in total`);
    if (interaction.created) out.push(`- Computations created: ${interaction.created}`);
    if (interaction.settledMs !== undefined) {
      out.push(`- Settled: ${ms(interaction.settledMs)} after the event`);
    }
  } else {
    out.push(`- Re-runs: ${entry.runs.length + entry.droppedRuns}`);
  }
  if (entry.flushes) out.push(`- Flushes: ${entry.flushes}, ${ms(entry.flushMs)}`);

  if (entry.writes.length) {
    out.push('', '## Writes', '');
    for (const write of entry.writes) out.push(`- ${changeText(write)}`);
  }

  if (entry.runs.length) {
    out.push('', '## Re-runs, in order', '');
    for (const run of entry.runs.slice(0, MAX_REPORT_RUNS)) {
      out.push(runLine(run));
      out.push(...causeLines(run.event.causes, 1));
    }
    const rest = entry.runs.length - MAX_REPORT_RUNS + entry.droppedRuns;
    if (rest > 0) out.push(`- … ${rest} more re-runs`);
  }

  if (entry.calls.length) {
    out.push('', '## Server calls', '');
    for (const { event } of entry.calls) {
      const status = event.status === undefined ? 'no response' : String(event.status);
      const outcome = event.outcome === 'ok' ? '' : ', failed';
      out.push(
        `- ${event.method} ${code(event.name ?? event.id)} → ${status} in ${ms(event.durationMs)}${outcome}`,
      );
    }
  }

  if (entry.holds.length) {
    out.push('', '## Holds', '');
    for (const hold of entry.holds) {
      const blockers = hold.blockers.length
        ? `, waiting on ${hold.blockers.map(code).join(', ')}`
        : '';
      const silent = hold.acknowledgements.length ? '' : ', with no pending state shown';
      out.push(`- ${ms(hold.holdMs)}${blockers}${silent}`);
    }
  }

  if (entry.navigations.length) {
    out.push('', '## Navigations', '');
    for (const navigation of entry.navigations) {
      const route = navigation.name ? `${code(navigation.name)} ` : '';
      out.push(`- ${route}to ${code(navigation.to ?? '?')}, ${navigation.outcome ?? 'pending'}`);
    }
  }

  return out.join('\n');
}
