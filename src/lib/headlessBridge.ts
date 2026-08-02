/**
 * The native interface available to the background sync page, and only there.
 *
 * `HeadlessSyncWorker` runs Calino's real CalDAV engine in a bare WebView so
 * the mirror can be refreshed while the app is closed. That WebView has no
 * Capacitor bridge — `Bridge` requires an Activity and a worker has none — so
 * the two native capabilities the sync needs are injected as a plain
 * `@JavascriptInterface` object instead. Everything here is synchronous
 * because that is what `addJavascriptInterface` gives us; the calls run on the
 * WebView's JS thread with nothing else to block.
 *
 * Present only on `headless.html`. In the normal app this is undefined and the
 * Capacitor plugins are used instead.
 */
export interface HeadlessBridge {
  /** One DAV request. Returns JSON: `{ok, response}` or `{ok: false, error}`. */
  davRequest(optionsJson: string): string
  /** Reconciles the calendar provider. Returns JSON counts, or `{error}`. */
  mirrorSync(payloadJson: string): string
  /** Writes to logcat under the `CalinoHeadlessSync` tag. */
  log(message: string): void
  /** Ends the pass. A non-empty string marks it failed, so the worker retries. */
  finish(error: string): void
}

export function getHeadlessBridge(): HeadlessBridge | undefined {
  return (globalThis as { CalinoHeadless?: HeadlessBridge }).CalinoHeadless
}

export function isHeadless(): boolean {
  return getHeadlessBridge() !== undefined
}
