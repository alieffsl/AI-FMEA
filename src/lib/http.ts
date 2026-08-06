/** Default ceiling for an API call before we assume nothing is coming back. */
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * `fetch` + JSON parsing with a hard timeout.
 *
 * Without a timeout a request can hang forever rather than fail: in local
 * development Vite proxies `/api` to port 3001, and when that server is not
 * running the proxied request never settles, so every caller sat on a spinner
 * with no way to tell that the backend was simply down.
 */
export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; method?: string; body?: unknown } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, method = "GET", body } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error(
        `The FMEA server did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
          "Check that the API is running (npm run dev:server).",
        { cause },
      );
    }
    throw new Error(
      "Could not reach the FMEA server. Check that the API is running (npm run dev:server).",
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(errData.error || `The FMEA server responded with ${response.status}.`);
  }

  return (await response.json()) as T;
}
