/**
 * `/messages?sessionId=…` — the POST half of the legacy HTTP+SSE transport.
 */

import { handleLegacyMessage } from '../lib/endpoints/messages.js';

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  fetch: (request) => handleLegacyMessage(request),
};
