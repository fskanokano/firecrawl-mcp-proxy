/**
 * Legacy HTTP+SSE transport: `POST /messages?sessionId=…`, the message half of
 * the stream opened by {@link ./sse.js}.
 */

import { API_KEY_QUERY_PARAM } from '../auth.js';
import { resolveDeps } from '../config.js';
import { forward } from '../forward.js';
import { gate } from '../gate.js';
import { jsonError } from '../http.js';
import { readBoundedBody } from '../upstream.js';

const METHODS = ['POST', 'OPTIONS'];

/**
 * @param {Request} request
 * @param {import('../config.js').GatewayDeps} [input]
 * @returns {Promise<Response>}
 */
export async function handleLegacyMessage(request, input) {
  const url = new URL(request.url);
  const deps = resolveDeps(input);
  const gated = gate(request, url, deps.resolved, METHODS);
  if (gated.response) return gated.response;

  if (!url.searchParams.get('sessionId')) {
    return jsonError(
      request,
      400,
      'missing_session_id',
      'The legacy SSE message endpoint requires a sessionId query parameter.',
    );
  }

  // Forward the client's query, minus the proxy credential.
  const target = new URL(deps.resolved.config.upstream.messages);
  for (const [key, value] of url.searchParams) {
    if (key === API_KEY_QUERY_PARAM) continue;
    target.searchParams.append(key, value);
  }

  const body = await readBoundedBody(request);
  if (body instanceof Response) return body;

  return forward(request, deps, target.toString(), { body });
}
