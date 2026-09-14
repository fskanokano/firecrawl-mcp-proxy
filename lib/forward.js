/**
 * The single owner of the forwarding path: send one request upstream, classify a
 * failed connection, and hand the answer back to the client.
 *
 * No endpoint spells out send → catch → respond by hand, and no endpoint decides
 * for itself what a broken upstream leg means.
 */

import { upstreamTimeout, upstreamUnavailable } from './http.js';
import { relayResponse } from './relay.js';
import { sendUpstream } from './upstream.js';

const DEFAULT_TIMEOUT_DESCRIPTION = 'Firecrawl did not answer before the upstream deadline.';

/**
 * Turn a failure on the upstream leg into the response the client gets.
 *
 * `AbortSignal.timeout` aborts with a TimeoutError while a client disconnect or
 * a reset connection aborts with AbortError, so only a real deadline breach is
 * reported as a timeout.
 *
 * @param {Request} request
 * @param {unknown} error
 * @param {string} [timeoutDescription]  Endpoint-specific wording for the 504.
 * @returns {Response}
 */
export function mapUpstreamFailure(
  request,
  error,
  timeoutDescription = DEFAULT_TIMEOUT_DESCRIPTION,
) {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return upstreamTimeout(request, timeoutDescription);
  }
  return upstreamUnavailable(request, error);
}

/**
 * Send one request upstream and relay the answer.
 *
 * @param {Request} request
 * @param {import('./config.js').ResolvedDeps} deps
 * @param {string} targetUrl
 * @param {{
 *   body?: ArrayBuffer,
 *   transform?: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
 * }} [options]  `transform` is forwarded to the relay, which applies it only to a
 *               successful response's body.
 * @returns {Promise<Response>}
 */
export async function forward(request, deps, targetUrl, options = {}) {
  try {
    const upstream = await sendUpstream({
      request,
      url: targetUrl,
      firecrawlApiKey: deps.resolved.config.firecrawlApiKey,
      fetchImpl: deps.fetchImpl,
      body: options.body,
    });
    return relayResponse(request, upstream, { transform: options.transform });
  } catch (error) {
    return mapUpstreamFailure(request, error);
  }
}
