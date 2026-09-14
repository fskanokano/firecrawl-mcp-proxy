/**
 * The single owner of the response shapes this proxy invents itself (JSON
 * errors, the CORS preflight, the 413/502/504 failures). Client-facing header
 * policy lives in ./client-headers.js.
 *
 * Error bodies intentionally mirror Firecrawl's own error shape
 * (`{ success: false, error: ... }` / `{ error, error_description }`) so that
 * clients see the same contract they would get from Firecrawl directly.
 */

import { applyClientHeaders, corsHeaders } from './client-headers.js';
import { misconfigurationMessage } from './config.js';

/**
 * Header bag accepted by our response helpers.
 *
 * @typedef {Headers | Record<string, string> | [string, string][]} HeadersLike
 */

/**
 * @param {Request} request
 * @param {unknown} body
 * @param {{ status?: number, headers?: HeadersLike }} [init]
 * @returns {Response}
 */
export function jsonResponse(request, body, init = {}) {
  const headers = applyClientHeaders(request, new Headers(init.headers));
  return Response.json(body, { status: init.status ?? 200, headers });
}

/**
 * @param {Request} request
 * @param {number} status
 * @param {string} error
 * @param {string} description
 * @param {{ headers?: HeadersLike }} [init]
 * @returns {Response}
 */
export function jsonError(request, status, error, description, init = {}) {
  return jsonResponse(
    request,
    { success: false, error, error_description: description },
    { status, headers: init.headers },
  );
}

/**
 * Answer a CORS preflight without touching auth or upstream.
 *
 * `allowedMethods` is the route's own method set — the same one the route's 405
 * names — so the preflight advertises exactly what the route accepts.
 *
 * @param {Request} request
 * @param {string[]} allowedMethods
 * @returns {Response}
 */
export function preflightResponse(request, allowedMethods) {
  return new Response(null, { status: 204, headers: corsHeaders(request, allowedMethods) });
}

/**
 * @param {Request} request
 * @param {string} allow
 * @returns {Response}
 */
export function methodNotAllowed(request, allow) {
  return jsonError(request, 405, 'method_not_allowed', `Allowed methods: ${allow}`, {
    headers: { allow },
  });
}

/**
 * 401 in Firecrawl's credential-recovery shape, with a standards-compliant
 * challenge so MCP clients surface it as an authentication problem.
 *
 * @param {Request} request
 * @param {'missing_api_key' | 'invalid_api_key'} code
 * @returns {Response}
 */
export function unauthorized(request, code) {
  const description =
    code === 'missing_api_key'
      ? 'No proxy API key was supplied. Send it as `Authorization: Bearer <PROXY_API_KEY>`, `x-api-key`, or `?apiKey=`.'
      : 'The supplied proxy API key is invalid. It must match this deployment\'s PROXY_API_KEY.';
  return jsonError(request, 401, code, description, {
    headers: {
      'www-authenticate': `Bearer error="invalid_token", error_description="${code}"`,
    },
  });
}

/**
 * 500 for a deployment missing its environment variables.
 *
 * @param {Request} request
 * @param {string[]} missing
 * @returns {Response}
 */
export function misconfiguredResponse(request, missing) {
  return jsonError(request, 500, 'proxy_misconfigured', misconfigurationMessage(missing));
}

/**
 * 502 when the upstream MCP service could not be reached or the connection
 * broke mid-flight.
 *
 * @param {Request} request
 * @param {unknown} error
 * @returns {Response}
 */
export function upstreamUnavailable(request, error) {
  const cause = error instanceof Error ? error.message : String(error);
  return jsonError(
    request,
    502,
    'upstream_unavailable',
    `Could not reach the Firecrawl MCP upstream: ${cause}`,
    { headers: { 'retry-after': '5' } },
  );
}

/**
 * 504 when the upstream leg did not answer within the deadline its caller set.
 *
 * @param {Request} request
 * @param {string} description
 * @returns {Response}
 */
export function upstreamTimeout(request, description) {
  return jsonError(request, 504, 'upstream_timeout', description);
}

/**
 * @param {Request} request
 * @param {number} limit
 * @returns {Response}
 */
export function payloadTooLarge(request, limit) {
  return jsonError(
    request,
    413,
    'payload_too_large',
    `Request body exceeds the ${limit} byte limit of this proxy.`,
  );
}
