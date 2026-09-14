/** Shared helpers for the test suite. */

/**
 * A valid environment bag for the proxy.
 *
 * @param {Record<string, string | undefined>} [overrides]
 * @returns {Record<string, string | undefined>}
 */
export function testEnv(overrides = {}) {
  return {
    PROXY_API_KEY: 'proxy-secret',
    FIRECRAWL_API_KEY: 'fc-test-key',
    ...overrides,
  };
}

/**
 * Build a fetch stub that records calls and answers from `handler`.
 *
 * @param {(call: { url: string, init: RequestInit, headers: Headers }) => Response | Promise<Response>} handler
 */
export function recordingFetch(handler) {
  /** @type {any[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : /** @type {Request} */ (input).url;
    const headers = new Headers(init?.headers ?? {});
    const call = { url, init: init ?? {}, headers };
    calls.push(call);
    return handler(call);
  };
  return { impl, calls };
}

/**
 * A recording fetch stub that answers every call the same way: the upstream for
 * tests that are about the proxy's behaviour rather than the request.
 *
 * @param {RequestInit['body']} [body]
 * @param {ResponseInit} [init]
 */
export function stubUpstream(body = '{}', init) {
  return recordingFetch(() => new Response(body, init));
}

/**
 * An SSE byte stream from literal chunks (chunks are split on purpose in tests).
 *
 * @param {string[]} chunks
 * @returns {ReadableStream<Uint8Array>}
 */
export function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/**
 * A JSON body reader that tolerates an empty body.
 *
 * @param {Response} response
 */
export async function json(response) {
  return JSON.parse(await response.text());
}
