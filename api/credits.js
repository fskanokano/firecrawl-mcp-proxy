/**
 * `/credits` — remaining Firecrawl credits for the configured account.
 *
 * Requires the proxy API key; the Firecrawl key stays on the server.
 */

import { handleCredits } from '../lib/endpoints/credits.js';

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  fetch: (request) => handleCredits(request),
};
