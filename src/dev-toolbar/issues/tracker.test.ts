import { describe, expect, it } from 'vitest';
import { issueReport } from '../report/issue-report.js';
import { addIssues, appOwnerPath, issueText, type IssueEvent } from './tracker.js';

function finding(over: Partial<IssueEvent> = {}): IssueEvent {
  return {
    sequence: 1,
    code: 'STRICT_READ_UNTRACKED',
    kind: 'strict-read',
    severity: 'warn',
    message: '[STRICT_READ_UNTRACKED] Reactive value "draft" read directly in <Draft>.',
    nodeName: 'draft',
    ownerPath: ['<App>', '<Draft>'],
    ...over,
  };
}

describe('issueText', () => {
  it('drops the code prefix the console needs', () => {
    expect(issueText(finding())).toBe('Reactive value "draft" read directly in <Draft>.');
    expect(issueText(finding({ message: 'plain' }))).toBe('plain');
  });
});

describe('appOwnerPath', () => {
  it('drops the toolbar owners and the scopes before the first app component', () => {
    expect(
      appOwnerPath([
        '<DevToolbar>',
        '<Errored>',
        'children',
        '<AppScope>',
        'computed',
        '<App>',
        'memo',
      ]),
    ).toEqual(['<App>', 'memo']);
  });

  it('keeps a path outside the toolbar as it is', () => {
    expect(appOwnerPath(['<App>', 'effect'])).toEqual(['<App>', 'effect']);
    expect(appOwnerPath(undefined)).toBeUndefined();
  });
});

describe('addIssues', () => {
  it('counts equal findings as one entry and moves it to the top', () => {
    const first = {};
    const second = {};
    let entries = addIssues([], [{ event: finding(), subject: first, at: 1 }]);
    entries = addIssues(entries, [
      { event: finding({ code: 'NO_OWNER_EFFECT', message: 'other' }), subject: undefined, at: 2 },
    ]);
    entries = addIssues(entries, [{ event: finding({ sequence: 3 }), subject: second, at: 3 }]);

    expect(entries.map((entry) => entry.event.code)).toEqual([
      'STRICT_READ_UNTRACKED',
      'NO_OWNER_EFFECT',
    ]);
    expect(entries[0]!.count).toBe(2);
    expect(entries[0]!.firstAt).toBe(1);
    expect(entries[0]!.lastAt).toBe(3);
    // The latest node, since the first one can be disposed.
    expect(entries[0]!.subject?.deref()).toBe(second);
  });

  it('keeps findings in different owners apart', () => {
    const entries = addIssues(
      [],
      [
        { event: finding(), subject: undefined, at: 1 },
        { event: finding({ ownerPath: ['<App>', '<Other>'] }), subject: undefined, at: 2 },
      ],
    );
    expect(entries).toHaveLength(2);
  });

  it('keeps the newest entries up to the limit', () => {
    const added = [1, 2, 3].map((n) => ({
      event: finding({ message: `m${n}` }),
      subject: undefined,
      at: n,
    }));
    expect(addIssues([], added, 2).map((entry) => entry.event.message)).toEqual(['m3', 'm2']);
  });
});

describe('issueReport', () => {
  it('describes the finding with its owner, count, guide and data', () => {
    const [entry] = addIssues(
      [],
      [
        {
          event: finding({ data: { token: 'abc', strictRead: '<Draft>' } }),
          subject: undefined,
          at: 1,
        },
        { event: finding(), subject: undefined, at: 2 },
      ],
    );
    const report = issueReport({ entry: entry!, guideUrl: 'https://guide#x', route: '/' });

    expect(report).toContain('# Solid issue (warn): `STRICT_READ_UNTRACKED`');
    expect(report).toContain('Reactive value "draft" read directly in <Draft>.');
    expect(report).toContain('- Owner path: `<App> > <Draft>`');
    expect(report).toContain('- Node: `draft`');
    expect(report).toContain('- Reported 2 times');
    expect(report).toContain('- Repair guide: https://guide#x');
  });

  it('redacts sensitive data', () => {
    const [entry] = addIssues(
      [],
      [
        {
          event: finding({ data: { token: 'abc', strictRead: '<Draft>' } }),
          subject: undefined,
          at: 1,
        },
      ],
    );
    const report = issueReport({ entry: entry!, guideUrl: undefined, route: '/' });
    expect(report).toContain('"token": "[redacted]"');
    expect(report).toContain('"strictRead": "<Draft>"');
    expect(report).not.toContain('Repair guide');
  });
});
