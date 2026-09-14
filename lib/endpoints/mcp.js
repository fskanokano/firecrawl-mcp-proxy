/**
 * Streamable HTTP MCP endpoint: `/mcp` and `/v2/mcp`.
 */

import { resolveDeps } from '../config.js';
import { forward } from '../forward.js';
import { gate } from '../gate.js';
import { readBoundedBody } from '../upstream.js';

const METHODS = ['GET', 'POST', 'DELETE', 'OPTIONS'];

/**
 * @param {Request} request
 * @param {import('../config.js').GatewayDeps} [input]
 * @returns {Promise<Response>}
 */
export async function handleMcp(request, input) {
  const url = new URL(request.url);
  const deps = resolveDeps(input);
  const gated = gate(request, url, deps.resolved, METHODS);
  if (gated.response) return gated.response;

  /** @type {ArrayBuffer | undefined} */
  let body;
  if (request.method === 'POST') {
    const read = await readBoundedBody(request);
    if (read instanceof Response) return read;
    body = read;
  }

  return forward(request, deps, deps.resolved.config.upstream.mcp, { body });
}
