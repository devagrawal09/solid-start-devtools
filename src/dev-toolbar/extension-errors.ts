/** The URL schemes browsers serve extension scripts from. */
const EXTENSION_URL = /^(?:chrome|moz|safari-web|ms-browser)-extension:\/\//;

/** The URL of the first frame of a stack, the one the value was thrown in. */
function firstFrameUrl(stack: string): string | undefined {
  for (const line of stack.split('\n')) {
    // V8 writes `at fn (url:line:col)`, Firefox and Safari write `fn@url:line:col`.
    const match = /(?:\(|@|at\s)([a-z][a-z0-9+.-]*:\/\/[^\s)]+)/i.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Whether a thrown value came from a browser extension rather than the app.
 * An extension's content script runs in the page, so its errors reach the
 * window's `error` and `unhandledrejection` events like the app's do.
 */
export function isExtensionError(error: unknown, filename?: string): boolean {
  if (filename && EXTENSION_URL.test(filename)) return true;
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return false;
  const url = firstFrameUrl(stack);
  return !!url && EXTENSION_URL.test(url);
}
