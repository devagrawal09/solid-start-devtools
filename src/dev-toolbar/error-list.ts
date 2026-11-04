/** Most errors the toolbar keeps. An error thrown in a loop drops the oldest. */
export const MAX_ERRORS = 200;

/** The list with `error` first, keeping at most `max` of the newest. */
export function addError<T>(list: readonly T[], error: T, max = MAX_ERRORS): T[] {
  const next = [error];
  for (const item of list) {
    if (next.length >= max) break;
    next.push(item);
  }
  return next;
}
