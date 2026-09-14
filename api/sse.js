/**
 * `/sse` — legacy HTTP+SSE transport for older MCP clients.
 * The `endpoint` event is rewritten so the client posts back through this proxy.
 */

import { handleLegacySse } from '../lib/endpoints/sse.js';

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  fetch: (request) => handleLegacySse(request),
};
