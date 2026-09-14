/**
 * Legacy HTTP+SSE transport support.
 *
 * The upstream opens the stream with an `endpoint` event naming a relative
 * message URL, e.g.
 *
 *     event: endpoint
 *     data: /messages?sessionId=6f4ca523-…
 *
 * The proxy exposes `/messages` at the same path, so the payload already
 * resolves against the proxy origin. We only need to add the proxy key for
 * clients that authenticate through `?apiKey=` (they cannot send headers on the
 * follow-up POST).
 */

// Stateless, so it is safe to share; the TextDecoder is NOT (it buffers partial
// multibyte sequences between calls) and is therefore created per stream.
const encoder = new TextEncoder();
const MESSAGE_ENDPOINT_PREFIX = '/messages';

/**
 * Rewrite one `data:` payload of an SSE `endpoint` event.
 *
 * @param {string} payload  A relative endpoint path such as an SSE `data:` line.
 * @param {string | undefined} apiKeyToAppend
 * @returns {string}
 */
export function rewriteEndpointPayload(payload, apiKeyToAppend) {
  // The live upstream always sends a relative path (`/messages?sessionId=…`), so
  // anything else is left exactly as it came.
  if (!payload.startsWith(MESSAGE_ENDPOINT_PREFIX)) return payload;

  const parsed = new URL(payload, 'http://proxy.invalid');
  if (apiKeyToAppend && !parsed.searchParams.has('apiKey')) {
    parsed.searchParams.set('apiKey', apiKeyToAppend);
  }

  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Split a single SSE line into its content and its line terminator.
 *
 * @param {string} line
 * @returns {[string, string]}
 */
function splitLineTerminator(line) {
  if (line.endsWith('\r\n')) return [line.slice(0, -2), '\r\n'];
  if (line.endsWith('\n')) return [line.slice(0, -1), '\n'];
  return [line, ''];
}

/**
 * Rewrite a single SSE line when it is a `data:` line.
 *
 * @param {string} line
 * @param {(payload: string) => string} rewrite
 * @returns {string}
 */
export function rewriteSseLine(line, rewrite) {
  const [content, terminator] = splitLineTerminator(line);
  if (!content.startsWith('data:')) return line;
  const payload = content.slice('data:'.length).replace(/^[ \t]/, '');
  const rewritten = rewrite(payload);
  if (rewritten === payload) return line;
  return `data: ${rewritten}${terminator}`;
}

/**
 * Wrap an upstream SSE byte stream so the first `endpoint` event points back at
 * this proxy. Once that event has been rewritten (it is always the first event),
 * later chunks are forwarded untouched, so tool payloads still stream
 * incrementally instead of being buffered line-by-line.
 *
 * @param {ReadableStream<Uint8Array>} source
 * @param {(payload: string) => string} rewrite
 * @returns {ReadableStream<Uint8Array>}
 */
export function rewriteSseStream(source, rewrite) {
  // One decoder per stream: a shared instance would carry one client's partial
  // multibyte character into the next client's stream.
  const decoder = new TextDecoder();
  let buffer = '';
  let endpointRewritten = false;

  return source.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (endpointRewritten) {
          controller.enqueue(chunk);
          return;
        }

        buffer += decoder.decode(chunk, { stream: true });

        for (;;) {
          const index = buffer.indexOf('\n');
          if (index === -1) break;
          const line = buffer.slice(0, index + 1);
          buffer = buffer.slice(index + 1);
          const rewritten = rewriteSseLine(line, rewrite);
          controller.enqueue(encoder.encode(rewritten));
          if (rewritten !== line) {
            endpointRewritten = true;
            break;
          }
        }

        if (endpointRewritten && buffer) {
          controller.enqueue(encoder.encode(buffer));
          buffer = '';
        }
      },
      flush(controller) {
        if (!endpointRewritten && buffer) {
          controller.enqueue(encoder.encode(rewriteSseLine(buffer, rewrite)));
        }
      },
    }),
  );
}
