/**
 * Client authentication for the proxy.
 *
 * Clients know only the *proxy* key. It may arrive as:
 *   - `Authorization: Bearer <PROXY_API_KEY>`
 *   - `x-api-key: <PROXY_API_KEY>`
 *   - `x-firecrawl-api-key: <PROXY_API_KEY>`  (some Firecrawl-native clients)
 *   - `?apiKey=<PROXY_API_KEY>`               (clients that cannot send headers)
 *
 * Whichever form is used, the presented value never reaches the upstream: the
 * proxy replaces it with its own FIRECRAWL_API_KEY.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** Header names that may carry the proxy key, in priority order. */
const API_KEY_HEADERS = ['x-firecrawl-api-key', 'x-api-key'];

/** Query parameter name that may carry the proxy key. */
export const API_KEY_QUERY_PARAM = 'apiKey';

/**
 * Collect every proxy-key candidate a request presents.
 *
 * @param {Request} request
 * @param {URL} url
 * @returns {string[]}
 */
export function collectPresentedKeys(request, url) {
  /** @type {string[]} */
  const keys = [];
  for (const header of API_KEY_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) keys.push(value);
  }

  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const bearer = /^bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (bearer) keys.push(bearer);

  const query = url.searchParams.get(API_KEY_QUERY_PARAM)?.trim();
  if (query) keys.push(query);
  return keys;
}

/**
 * Constant-time comparison that also hides length differences.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function constantTimeEquals(a, b) {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * The presented credential that authenticates this request, or undefined when
 * none does. Returning the credential rather than a boolean means a caller that
 * needs to know *what* the client authenticated with never has to compare
 * secrets a second time.
 *
 * @param {readonly string[]} presentedKeys
 * @param {string} expectedKey
 * @returns {string | undefined}
 */
export function matchCredential(presentedKeys, expectedKey) {
  if (!expectedKey) return undefined;
  /** @type {string | undefined} */
  let credential;
  // Deliberately compare against *all* candidates so the response time does not
  // reveal which header supplied the matching key.
  for (const candidate of presentedKeys) {
    if (constantTimeEquals(candidate, expectedKey)) credential ??= candidate;
  }
  return credential;
}
