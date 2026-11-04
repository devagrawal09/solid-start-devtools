import { describe, expect, it } from 'vitest';
import { isExtensionError } from './extension-errors.js';

function withStack(stack: string): Error {
  const error = new Error('boom');
  error.stack = stack;
  return error;
}

describe('isExtensionError', () => {
  it('trusts the file an error event names', () => {
    expect(isExtensionError(undefined, 'chrome-extension://abc/executors/200.js')).toBe(true);
    expect(isExtensionError(undefined, 'http://localhost:5173/src/app.tsx')).toBe(false);
  });

  it('reads the first frame of a V8 stack', () => {
    const stack = 'TypeError: x\n    at Y (chrome-extension://abc/executors/200.js:1:761)';
    expect(isExtensionError(withStack(stack))).toBe(true);
  });

  it('reads the first frame of a Firefox or Safari stack', () => {
    expect(isExtensionError(withStack('x@moz-extension://123/content.js:3:9'))).toBe(true);
    expect(isExtensionError(withStack('x@safari-web-extension://123/c.js:1:1'))).toBe(true);
  });

  it('keeps an app error that passed through an extension further down', () => {
    const stack = [
      'Error: boom',
      '    at Broken (http://localhost:5173/src/app.tsx:12:9)',
      '    at wrapped (chrome-extension://abc/hook.js:1:1)',
    ].join('\n');
    expect(isExtensionError(withStack(stack))).toBe(false);
  });

  it('keeps values with no stack', () => {
    expect(isExtensionError('a string')).toBe(false);
    expect(isExtensionError(new Error('no stack'))).toBe(false);
  });
});
