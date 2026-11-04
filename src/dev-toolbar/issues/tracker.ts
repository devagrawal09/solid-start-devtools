import { OBSERVE } from 'solid-js';

/** One finding of the runtime's diagnostics channel, as `OBSERVE.diagnostics` delivers it. */
export interface IssueEvent {
  sequence: number;
  code: string;
  kind: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  ownerId?: string;
  ownerName?: string;
  nodeName?: string;
  ownerPath?: string[];
  data?: Record<string, unknown>;
}

/**
 * An issue in the panel. The runtime can report the same finding many times,
 * such as a read in a list row, so equal findings are one entry with a count.
 */
export interface IssueEntry {
  key: string;
  event: IssueEvent;
  /**
   * The owner or signal the finding is about. Held weakly, so the panel does
   * not keep a disposed part of the app alive.
   */
  subject: WeakRef<object> | undefined;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** Most entries the panel keeps. The oldest go first. */
export const MAX_ISSUES = 200;

/** The message without the `[CODE]` prefix the runtime puts on it for the console. */
export function issueText(event: IssueEvent): string {
  const prefix = `[${event.code}] `;
  return event.message.startsWith(prefix) ? event.message.slice(prefix.length) : event.message;
}

/** The component the toolbar wraps the app in. Owners above it are the toolbar's. */
const APP_SCOPE = '<AppScope>';

/**
 * The owner path from the app's first component down. The toolbar's own
 * owners, and the scopes between them and the app, are dropped.
 */
export function appOwnerPath(path: string[] | undefined): string[] | undefined {
  if (!path) return path;
  const scope = path.indexOf(APP_SCOPE);
  if (scope === -1) return path;
  const rest = path.slice(scope + 1);
  const first = rest.findIndex((name) => name.startsWith('<'));
  return first === -1 ? rest : rest.slice(first);
}

function keyOf(event: IssueEvent): string {
  return [event.code, event.ownerPath?.join('>') ?? '', event.nodeName ?? '', event.message].join(
    '\n',
  );
}

/**
 * Adds findings to the entries, newest first. A finding equal to an entry
 * moves that entry to the top and counts it again.
 */
export function addIssues(
  entries: IssueEntry[],
  added: { event: IssueEvent; subject: object | undefined; at: number }[],
  max = MAX_ISSUES,
): IssueEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  for (const { event, subject, at } of added) {
    const key = keyOf(event);
    const current = byKey.get(key);
    byKey.delete(key);
    byKey.set(
      key,
      current
        ? {
            ...current,
            event,
            // The latest node, since an earlier one can be disposed by now.
            subject: subject ? new WeakRef(subject) : current.subject,
            count: current.count + 1,
            lastAt: at,
          }
        : {
            key,
            event,
            subject: subject ? new WeakRef(subject) : undefined,
            count: 1,
            firstAt: at,
            lastAt: at,
          },
    );
  }
  // The map keeps insertion order, so the latest findings are at its end.
  return Array.from(byKey.values()).reverse().slice(0, max);
}

/** True when the runtime has a diagnostics channel, which is in dev and observe builds. */
export function isIssuesAvailable(): boolean {
  return !!OBSERVE?.diagnostics;
}

/**
 * Listens to the diagnostics channel. The runtime calls the listener inside
 * the scope that misbehaved, where writing a signal is itself a finding, so
 * findings are collected and handed over on a microtask.
 */
export function captureIssues(
  push: (added: { event: IssueEvent; subject: object | undefined; at: number }[]) => void,
): () => void {
  const diagnostics = OBSERVE?.diagnostics;
  if (!diagnostics) return () => {};
  let pending: { event: IssueEvent; subject: object | undefined; at: number }[] = [];
  return diagnostics.subscribe((event, subject) => {
    if (!pending.length) {
      queueMicrotask(() => {
        const batch = pending;
        pending = [];
        push(batch);
      });
    }
    const finding = event as IssueEvent;
    pending.push({
      event: { ...finding, ownerPath: appOwnerPath(finding.ownerPath) },
      subject: subject ?? undefined,
      at: Date.now(),
    });
  });
}
