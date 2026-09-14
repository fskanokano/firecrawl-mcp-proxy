/**
 * Legacy HTTP+SSE transport: `GET /sse`.
 *
 * The upstream opens the stream with an `endpoint` event naming a relative
 * message URL that already resolves against this proxy's origin, so the only
 * rewrite is adding the proxy key for clients that authenticate through
 * `?apiKey=` (they cannot send headers on the follow-up POST).
 */

import { API_KEY_QUERY_PARAM } from '../auth.js';
import { resolveDeps } from '../config.js';
import { forward } from '../forward.js';
import { gate } from '../gate.js';
import { rewriteEndpointPayload, rewriteSseStream } from '../sse-rewrite.js';

const METHODS = ['GET', 'OPTIONS'];

/**
 * @param {Request} request
 * @param {import('../config.js').GatewayDeps} [input]
 * @returns {Promise<Response>}
 */
export async function handleLegacySse(request, input) {
  const url = new URL(request.url);
  const deps = resolveDeps(input);
  const gated = gate(request, url, deps.resolved, METHODS);
  if (gated.response) return gated.response;

  // Echo the credential back into the stream only when the query string is where
  // it came from: header-based clients already carry it on the follow-up POST,
  // and a stray `?apiKey=` must not be reflected at them.
  const queryKey = url.searchParams.get(API_KEY_QUERY_PARAM)?.trim();
  const appendApiKey = queryKey && queryKey === gated.credential ? queryKey : undefined;

  return forward(request, deps, deps.resolved.config.upstream.sse, {
    transform: (body) =>
      rewriteSseStream(body, (payload) => rewriteEndpointPayload(payload, appendApiKey)),
  });
}
