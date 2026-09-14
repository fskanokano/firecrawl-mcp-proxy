/**
 * The single owner of the client-facing response header policy: which upstream
 * headers are relayed back, which of them a browser is allowed to read, and the
 * CORS and caching defaults every response carries.
 *
 * `access-control-expose-headers` is derived from the relay list on purpose. A
 * header that is relayed but not exposed is invisible to browser clients, so
 * listing the two separately is a silent failure waiting to happen.
 */

/**
 * Client headers this proxy accepts, for CORS preflight. `user-agent` and
 * `accept-language` are absent: browsers cannot set them anyway, and the proxy
 * does not forward them to Firecrawl.
 */
const ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
  'x-api-key',
  'x-firecrawl-api-key',
].join(', ');

/**
 * Upstream response headers worth relaying back to the client.
 *
 * `allow` is here because the upstream answers a rejected method with its own
 * 405 and RFC 9110 requires that response to name the allowed methods; dropping
 * it would leave clients with a 405 they cannot act on.
 */
export const RELAYED_UPSTREAM_HEADERS = [
  'allow',
  'content-type',
  'cache-control',
  'mcp-session-id',
  'mcp-protocol-version',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-firecrawl-request-id',
  'x-request-id',
];

/**
 * CORS headers for the current request. The origin is echoed (never `*`) so
 * browser-based MCP clients that send credentials keep working.
 *
 * `allowedMethods` is the calling route's own method set, and only a preflight
 * passes it, because `access-control-allow-methods` is the one CORS method list
 * a browser acts on and it is defined for preflight responses. The caller feeds
 * the same list to its 405 `allow` header, so what a preflight promises and what
 * the route accepts cannot disagree. Nothing here is a union across routes: no
 * list is advertised without a route to back it.
 *
 * @param {Request} request
 * @param {string[]} [allowedMethods]
 * @returns {Record<string, string>}
 */
export function corsHeaders(request, allowedMethods) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  /** @type {Record<string, string>} */
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS,
    'access-control-expose-headers': RELAYED_UPSTREAM_HEADERS.join(', '),
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (allowedMethods) headers['access-control-allow-methods'] = allowedMethods.join(', ');
  return headers;
}

/**
 * Finish a client-facing header set: apply the CORS policy and default to
 * `no-store` when nothing set a cache policy. Every response a client receives
 * passes through here, whether its headers came from upstream or from this proxy.
 *
 * @param {Request} request
 * @param {Headers} headers
 * @returns {Headers}
 */
export function applyClientHeaders(request, headers) {
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return headers;
}
