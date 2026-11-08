import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function resolvePackage(...conditions: string[]): string {
  return resolveSpecifier('@solidjs/start-devtools', ...conditions);
}

function resolveSpecifier(specifier: string, ...conditions: string[]): string {
  return execFileSync(
    process.execPath,
    [
      ...conditions.map((condition) => `--conditions=${condition}`),
      '--input-type=module',
      '--eval',
      `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`,
    ],
    { encoding: 'utf-8' },
  ).trim();
}

describe('package exports', () => {
  it('uses the no-op build by default', () => {
    expect(resolvePackage()).toMatch(/\/dist\/noop\.js$/);
  });

  it('uses the server build for development in Node', () => {
    expect(resolvePackage('development')).toMatch(/\/dist\/server\.js$/);
  });

  it('passes children through in the default build', async () => {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { DevToolbar, mountDevToolbar } from '@solidjs/start-devtools';
           console.log(JSON.stringify({
             children: DevToolbar({ children: 'content' }),
             disposed: mountDevToolbar()(),
           }));`,
        ],
        { encoding: 'utf-8' },
      ),
    );

    expect(result).toEqual({ children: 'content' });
  });

  it('uses the time-travel passthrough by default and on the server', () => {
    expect(resolveSpecifier('@solidjs/start-devtools/time-travel')).toMatch(
      /\/dist\/time-travel-noop\.js$/,
    );
    expect(resolveSpecifier('@solidjs/start-devtools/time-travel', 'development')).toMatch(
      /\/dist\/time-travel-noop\.js$/,
    );
  });

  it('uses the time-travel runtime for development in the browser', () => {
    expect(
      resolveSpecifier('@solidjs/start-devtools/time-travel', 'development', 'browser'),
    ).toMatch(/\/dist\/time-travel\.js$/);
  });

  it('returns the primitive itself from the time-travel passthrough', () => {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { createTracked, getTimeline } from '@solidjs/start-devtools/time-travel';
           const create = (value) => ['primitive', value];
           console.log(JSON.stringify({
             tracked: createTracked(create, 1),
             timeline: getTimeline() ?? null,
           }));`,
        ],
        { encoding: 'utf-8' },
      ),
    );

    expect(result).toEqual({ tracked: ['primitive', 1], timeline: null });
  });
});
