import { describe, expect, it } from 'vitest';
import { addError, MAX_ERRORS } from './error-list.js';

describe('addError', () => {
  it('puts the new error first', () => {
    expect(addError(['b', 'a'], 'c')).toEqual(['c', 'b', 'a']);
  });

  it('drops the oldest past the limit', () => {
    expect(addError(['c', 'b', 'a'], 'd', 3)).toEqual(['d', 'c', 'b']);
  });

  it('keeps 200 by default', () => {
    let list: number[] = [];
    for (let i = 0; i < MAX_ERRORS + 5; i++) list = addError(list, i);
    expect(list).toHaveLength(MAX_ERRORS);
    expect(list[0]).toBe(MAX_ERRORS + 4);
  });
});
