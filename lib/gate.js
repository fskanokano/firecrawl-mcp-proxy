/**
 * The single owner of request admission: deployment configuration, HTTP method
 * and client credential. Every authenticated endpoint starts here, so the order
 * of those checks, the shape of their failures and the identity of the credential
 * that got in all live in one place.
 */

import { collectPresentedKeys, matchCredential } from './auth.js';
import {
  methodNotAllowed,
  misconfiguredResponse,
  preflightResponse,
  unauthorized,
} from './http.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {import('./config.js').ConfigResolution} resolved
 * @param {string[]} allowedMethods
 * @returns {{ response?: Response, credential?: string }} `response` when the
 *          request must be answered without touching upstream, otherwise
 *          `credential`: the proxy key the client authenticated with.
 */
export function gate(request, url, resolved, allowedMethods) {
  if (request.method === 'OPTIONS') return { response: preflightResponse(request, allowedMethods) };
  if (!resolved.ok) return { response: misconfiguredResponse(request, resolved.missing) };
  if (!allowedMethods.includes(request.method)) {
    return { response: methodNotAllowed(request, allowedMethods.join(', ')) };
  }

  const presented = collectPresentedKeys(request, url);
  if (presented.length === 0) return { response: unauthorized(request, 'missing_api_key') };

  const credential = matchCredential(presented, resolved.config.proxyApiKey);
  if (!credential) return { response: unauthorized(request, 'invalid_api_key') };

  return { credential };
}
