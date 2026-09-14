/**
 * `/mcp` and `/v2/mcp` — the Firecrawl MCP surface (all 25 tools),
 * Streamable HTTP transport.
 */

import { handleMcp } from '../lib/endpoints/mcp.js';

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  fetch: (request) => handleMcp(request),
};
