/**
 * The single owner of talking to Firecrawl: how the credential is presented,
 * which client headers travel upstream, how a request body is bounded, and how a
 * request is sent.
 *
 * No endpoint builds an upstream request by hand or decides for itself whether a
 * body is too large; they all come through here.
 */

import { MAX_REQUEST_BYTES } from './config.js';
import { payloadTooLarge } from './http.js';

/**
 * Client headers worth relaying upstream. Everything else — cookies, client
 * credentials, proxy/platform headers — is dropped on purpose.
 *
 * `user-agent` and `accept-language` are absent: they say nothing about the
 * JSON-RPC call and forwarding them would only pass the client's fingerprint on
 * to Firecrawl.
 */
const UPSTREAM_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];

/**
 * How the Firecrawl credential is presented upstream — the only place that
 * decides this.
 *
 * @param {string} firecrawlApiKey
 * @returns {string}
 */
export function firecrawlAuthorization(firecrawlApiKey) {
  return `Bearer ${firecrawlApiKey}`;
}

/**
 * Build the headers for an upstream request: an allowlist of client headers
 * plus the injected Firecrawl credential. Client-supplied credentials never
 * survive this step, because neither `authorization` nor `x-api-key` is on the
 * allowlist and the credential below overwrites any that were.
 *
 * @param {Request} request
 * @param {string} firecrawlApiKey
 * @returns {Headers}
 */
function upstreamHeaders(request, firecrawlApiKey) {
  const headers = new Headers();
  for (const name of UPSTREAM_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('authorization', firecrawlAuthorization(firecrawlApiKey));
  return headers;
}

/**
 * Read a request body, refusing anything above the proxy's limit with the 413
 * the client should get instead.
 *
 * @param {Request} request
 * @returns {Promise<Response | ArrayBuffer | undefined>} The body bytes,
 *          `undefined` for an empty body, or the response to send instead.
 */
export async function readBoundedBody(request) {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_REQUEST_BYTES) return payloadTooLarge(request, MAX_REQUEST_BYTES);
  return buffer.byteLength === 0 ? undefined : buffer;
}

/**
 * Send one request to Firecrawl on behalf of the client. Throws when the
 * connection itself fails; {@link ./forward.js} maps that.
 *
 * @param {object} params
 * @param {Request} params.request          Incoming client request (for method, headers, abort).
 * @param {string} params.url               Absolute upstream URL.
 * @param {string} params.firecrawlApiKey
 * @param {typeof fetch} params.fetchImpl
 * @param {ArrayBuffer | undefined} [params.body]
 * @returns {Promise<Response>}
 */
export function sendUpstream({ request, url, firecrawlApiKey, fetchImpl, body }) {
  return fetchImpl(url, {
    method: request.method,
    headers: upstreamHeaders(request, firecrawlApiKey),
    body,
    signal: request.signal,
  });
}
