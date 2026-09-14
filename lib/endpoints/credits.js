/**
 * Credit usage endpoint: `GET /credits`.
 *
 * Unlike the MCP transports this is a plain server-to-server call to Firecrawl's
 * REST API: no client headers are relayed, and the answer is Firecrawl's own
 * schema with a `checkedAt` stamp added.
 */

import { CREDITS_TIMEOUT_MS, resolveDeps } from '../config.js';
import { mapUpstreamFailure } from '../forward.js';
import { gate } from '../gate.js';
import { jsonResponse } from '../http.js';
import { relayConsumedResponse } from '../relay.js';
import { firecrawlAuthorization } from '../upstream.js';

const METHODS = ['GET', 'OPTIONS'];

/**
 * @param {Request} request
 * @param {import('../config.js').GatewayDeps} [input]
 * @returns {Promise<Response>}
 */
export async function handleCredits(request, input) {
  const url = new URL(request.url);
  const deps = resolveDeps(input);
  const gated = gate(request, url, deps.resolved, METHODS);
  if (gated.response) return gated.response;

  const { config } = deps.resolved;

  /** @type {Response} */
  let upstream;
  /** @type {string} */
  let text;
  try {
    upstream = await deps.fetchImpl(config.creditsUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: firecrawlAuthorization(config.firecrawlApiKey),
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(CREDITS_TIMEOUT_MS)]),
    });
    // Read here rather than later so a connection that dies mid-body is reported
    // like any other upstream failure instead of escaping as a 500.
    text = await upstream.text();
  } catch (error) {
    return mapUpstreamFailure(
      request,
      error,
      `Firecrawl did not answer the credit usage request within ${CREDITS_TIMEOUT_MS}ms.`,
    );
  }

  if (upstream.ok) {
    try {
      const payload = JSON.parse(text);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return jsonResponse(
          request,
          { ...payload, checkedAt: new Date().toISOString() },
          { status: upstream.status },
        );
      }
    } catch {
      // Non-JSON upstream body: relay it verbatim below.
    }
  }

  return relayConsumedResponse(request, upstream, text);
}
