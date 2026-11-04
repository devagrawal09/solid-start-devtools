import { concernOf, type AsyncRecord } from '../async/tracker.js';
import type { ServerFunctionInstance } from '../functions/index.js';
import { issueText, type IssueEntry } from '../issues/tracker.js';
import { isUnnamedUpdate, type TimelineEntry } from '../timeline/tracker.js';
import { asyncDuration, asyncOrigin, asyncTitle } from './async-report.js';
import { errorReport, type ReportFrame } from './error-report.js';
import { code } from './markdown.js';
import { redactText, redactUrl } from './redact.js';
import { ms, plural } from './timeline-report.js';

/** Errors the session report gives in full, newest first. The rest are counted. */
export const SESSION_ERRORS = 3;
/** Issues the session report lists. */
export const SESSION_ISSUES = 20;
/** Timeline actions the session report lists, newest first. */
export const SESSION_ACTIONS = 5;
/** Flagged async records the session report lists. */
export const SESSION_ASYNC = 10;

export interface SessionError {
  error: unknown;
  frames: ReportFrame[];
}

export interface SessionReportInput {
  /** Newest first, as the error panel keeps them. */
  errors: SessionError[];
  /** How many errors there are in all, which can be more than `errors` holds. */
  errorCount: number;
  issues: IssueEntry[];
  timeline: TimelineEntry[];
  asyncRecords: AsyncRecord[];
  calls: ServerFunctionInstance[];
  /** The path and query of the page. */
  route: string;
  /** The devtools version, so a reader knows what made the report. */
  version: string;
}

/**
 * Puts a report one heading level lower, so it reads as a section of another
 * report. Lines inside code blocks are left alone.
 */
export function demote(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const marks = line.match(/^(`{3,})/)?.[1];
      if (marks && (fence === undefined || marks.length >= fence.length)) {
        fence = fence === undefined ? marks : undefined;
        return line;
      }
      return fence === undefined && line.startsWith('#') ? `#${line}` : line;
    })
    .join('\n');
}

function failedCall(instance: ServerFunctionInstance): string | undefined {
  const { request, response } = instance;
  const name = code(request.meta?.name ?? request.id);
  if (response && !response.source.ok) {
    return `- ${request.source.method} ${name} → ${response.source.status}`;
  }
  const error = request.meta?.error;
  if (!response && error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return `- ${request.source.method} ${name} → no response: ${redactText(message)}`;
  }
  return undefined;
}

function actionLine(entry: TimelineEntry): string {
  const parts = [
    plural(entry.writes.length, 'write'),
    plural(entry.interaction?.runs ?? entry.runs.length + entry.droppedRuns, 're-run'),
  ];
  if (entry.calls.length) parts.push(plural(entry.calls.length, 'call'));
  const time = entry.interaction?.settledMs ?? entry.flushMs;
  const outcome = entry.interaction?.outcome ? `, ${entry.interaction.outcome}` : '';
  const writes = entry.writes.length
    ? `: ${entry.writes.map((write) => code(write.name)).join(', ')}`
    : '';
  return `- ${code(entry.label)}, ${parts.join(', ')} in ${ms(time)}${outcome}${writes}`;
}

/**
 * One Markdown report of everything the devtools noticed, for an agent to
 * read when it is not clear which panel holds the problem. Each panel adds a
 * section only when it has something in it.
 */
export function sessionReport(input: SessionReportInput): string {
  const out: string[] = ['# Solid devtools session', ''];
  out.push(`- Page: ${code(redactUrl(input.route))}`);
  out.push(`- Devtools: ${input.version}`);

  const failed = input.calls.map(failedCall).filter((line) => line !== undefined);
  // The same updates the timeline hides by default, so the newest actions are real ones.
  const actions = input.timeline.filter((entry) => !isUnnamedUpdate(entry));
  const flagged = input.asyncRecords.filter((record) => concernOf(record));
  const empty =
    !input.errorCount &&
    !input.issues.length &&
    !actions.length &&
    !flagged.length &&
    !failed.length;
  if (empty) {
    out.push('', 'Nothing to report: no errors, issues, actions, async concerns or failed calls.');
    return out.join('\n');
  }

  if (input.errorCount) {
    out.push('', `## Errors (${input.errorCount})`);
    for (const { error, frames } of input.errors.slice(0, SESSION_ERRORS)) {
      out.push('', demote(demote(errorReport({ error, frames, route: input.route }))));
    }
    const rest = input.errorCount - Math.min(input.errors.length, SESSION_ERRORS);
    if (rest > 0) out.push('', `… ${plural(rest, 'older error')} not shown.`);
  }

  if (input.issues.length) {
    out.push('', `## Issues (${input.issues.length})`, '');
    for (const entry of input.issues.slice(0, SESSION_ISSUES)) {
      const { event, count } = entry;
      const times = count > 1 ? ` ×${count}` : '';
      const owner = event.ownerPath?.length ? ` in ${code(event.ownerPath.join(' > '))}` : '';
      out.push(
        `- ${event.severity} ${code(event.code)}${times}${owner}: ${redactText(issueText(event))}`,
      );
    }
    const rest = input.issues.length - SESSION_ISSUES;
    if (rest > 0) out.push(`- … ${plural(rest, 'more issue')}`);
  }

  if (actions.length) {
    out.push('', '## Recent actions, newest first', '');
    for (const entry of actions.slice(0, SESSION_ACTIONS)) out.push(actionLine(entry));
  }

  if (flagged.length) {
    out.push('', `## Async concerns (${flagged.length})`, '');
    for (const record of flagged.slice(0, SESSION_ASYNC)) {
      const origin = asyncOrigin(record);
      out.push(
        `- ${code(asyncTitle(record))}, ${ms(asyncDuration(record))}: ${concernOf(record)}${origin ? `, started by ${code(origin)}` : ''}`,
      );
    }
  }

  if (failed.length) {
    out.push('', `## Failed server calls (${failed.length})`, '');
    out.push(...failed);
  }

  out.push('', 'Each panel of the devtools has a copy button for the full report of one item.');
  return out.join('\n');
}
