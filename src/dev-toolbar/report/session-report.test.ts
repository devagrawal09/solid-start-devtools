import { describe, expect, it } from 'vitest';
import { AsyncHistory } from '../async/tracker.js';
import type { ServerFunctionInstance } from '../functions/index.js';
import { addIssues } from '../issues/tracker.js';
import { TimelineBuilder } from '../timeline/tracker.js';
import { demote, sessionReport, type SessionReportInput } from './session-report.js';

function input(over: Partial<SessionReportInput> = {}): SessionReportInput {
  return {
    errors: [],
    errorCount: 0,
    issues: [],
    timeline: [],
    asyncRecords: [],
    calls: [],
    route: '/todos',
    version: '1.0.0',
    ...over,
  };
}

describe('demote', () => {
  it('moves headings down a level and leaves code blocks alone', () => {
    expect(demote('# Title\n\n```\n# not a heading\n```\n## Part')).toBe(
      '## Title\n\n```\n# not a heading\n```\n### Part',
    );
  });
});

describe('sessionReport', () => {
  it('says when there is nothing to report', () => {
    const report = sessionReport(input());
    expect(report).toContain('# Solid devtools session');
    expect(report).toContain('- Page: `/todos`');
    expect(report).toContain('Nothing to report');
  });

  it('has a section for each panel with something in it', () => {
    const issues = addIssues(
      [],
      [
        {
          event: {
            sequence: 1,
            code: 'STRICT_READ_UNTRACKED',
            kind: 'strict-read',
            severity: 'warn',
            message: '[STRICT_READ_UNTRACKED] Read outside tracking.',
            ownerPath: ['<App>', '<Draft>'],
          },
          subject: undefined,
          at: 1,
        },
      ],
    );

    const timeline = new TimelineBuilder();
    const click = { kind: 'interaction' as const, name: 'click', target: 'button#inc', at: 1 };
    timeline.rerun(
      {
        run: 1,
        at: 2,
        nodeRuns: 1,
        nodeKind: 'memo',
        nodeName: 'doubled',
        nodeId: 1,
        causes: [{ seq: 1, kind: 'write', name: 'count', prev: '0', value: '1', origin: click }],
        depCount: 1,
        depsAdded: [],
        depsRemoved: [],
        selfMs: 0.2,
        totalMs: 0.2,
        changed: true,
        phase: 'plain',
        held: false,
        interaction: click,
      },
      undefined,
    );

    const history = new AsyncHistory();
    history.fallback({ at: 1, shownMs: 80, ownerPath: ['<App>', '<Loading>'] }, undefined);
    history.fallback({ at: 1, shownMs: 400 }, undefined);

    const calls: ServerFunctionInstance[] = [
      {
        request: {
          type: 'request',
          id: 'save',
          instance: 'save#1',
          source: new Request('http://localhost/_server', { method: 'POST' }),
          meta: { name: 'save' },
          time: 1,
        },
        response: {
          type: 'response',
          id: 'save',
          instance: 'save#1',
          source: new Response(null, { status: 500 }),
          meta: { name: 'save' },
          time: 2,
        },
      },
    ];

    const report = sessionReport(
      input({
        errors: [{ error: new TypeError('boom'), frames: [] }],
        errorCount: 4,
        issues,
        timeline: timeline.snapshot(),
        asyncRecords: history.records,
        calls,
      }),
    );

    expect(report).toContain('## Errors (4)');
    // The error report sits inside its section, two levels down.
    expect(report).toContain('### Error in a Solid app');
    expect(report).toContain('TypeError: boom');
    expect(report).toContain('… 3 older errors not shown.');
    expect(report).toContain(
      '## Issues (1)\n\n- warn `STRICT_READ_UNTRACKED` in `<App> > <Draft>`: Read outside tracking.',
    );
    expect(report).toContain(
      '## Recent actions, newest first\n\n- `click on button#inc`, 1 write, 1 re-run',
    );
    expect(report).toContain(
      '## Async concerns (1)\n\n- `fallback at <App> › <Loading>`, 80.0ms: flash',
    );
    expect(report).toContain('## Failed server calls (1)\n\n- POST `save` → 500');
  });
});
