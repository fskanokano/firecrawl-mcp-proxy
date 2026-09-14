/**
 * The single owner of turning an upstream response into the client response:
 * streaming the body back without buffering it, and handing the relayed headers
 * to the shared client-header policy in ./client-headers.js.
 */

import { RELAYED_UPSTREAM_HEADERS, applyClientHeaders } from './client-headers.js';

/**
 * Copy the named headers from an upstream response.
 *
 * @param {Response} upstream
 * @param {readonly string[]} names
 * @returns {Headers}
 */
function relayedHeaders(upstream, names) {
  const headers = new Headers();
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/**
 * Relay an upstream response, preserving streaming and the headers that matter
 * for MCP session handling.
 *
 * @param {Request} request
 * @param {Response} upstream
 * @param {{ transform?: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array> }} [options]
 *        Optional body transform (used by the legacy SSE transport to rewrite the
 *        `endpoint` event). Applied only to a successful response's body: a
 *        rejected response is not a transport payload, so it is relayed verbatim.
 * @returns {Response}
 */
export function relayResponse(request, upstream, options = {}) {
  const headers = applyClientHeaders(request, relayedHeaders(upstream, RELAYED_UPSTREAM_HEADERS));
  const body = upstream.body && upstream.status !== 204 && upstream.status !== 304 ? upstream.body : null;
  const transformed = body && upstream.ok && options.transform ? options.transform(body) : body;

  return new Response(transformed, { status: upstream.status, headers });
}

/**
 * Relay a body the handler already read (for example to decorate JSON), keeping
 * the upstream status and content type.
 *
 * Only the content type is relayed here: the body is re-serialized by the
 * handler, so an upstream validator such as `etag` would be wrong to forward.
 *
 * @param {Request} request
 * @param {Response} upstream
 * @param {string} body
 * @returns {Response}
 */
export function relayConsumedResponse(request, upstream, body) {
  const headers = applyClientHeaders(request, relayedHeaders(upstream, ['content-type']));
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(body, { status: upstream.status, headers });
}
