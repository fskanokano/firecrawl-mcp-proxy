import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteEndpointPayload, rewriteSseLine, rewriteSseStream } from '../lib/sse-rewrite.js';
import { streamOf } from './support.js';

/**
 * The rewrite the legacy SSE endpoint applies: add the proxy key to the endpoint.
 *
 * @param {string} payload
 * @returns {string}
 */
const addKey = (payload) => rewriteEndpointPayload(payload, 'k');

/**
 * Rewrite a source stream chunk by chunk and read the whole result back.
 *
 * @param {string[]} chunks
 * @returns {Promise<string>}
 */
const rewriteAll = (chunks) => new Response(rewriteSseStream(streamOf(chunks), addKey)).text();

test('adds the proxy credential to the legacy message endpoint', () => {
  assert.equal(
    rewriteEndpointPayload('/messages?sessionId=abc', 'proxy-secret'),
    '/messages?sessionId=abc&apiKey=proxy-secret',
  );
});

test('leaves the endpoint alone when there is no credential to relay', () => {
  assert.equal(rewriteEndpointPayload('/messages?sessionId=abc', undefined), '/messages?sessionId=abc');
});

test('never overwrites a credential the client already sent', () => {
  assert.equal(
    rewriteEndpointPayload('/messages?sessionId=abc&apiKey=client-key', 'proxy-secret'),
    '/messages?sessionId=abc&apiKey=client-key',
  );
});

test('ignores payloads that are not message endpoints', () => {
  assert.equal(rewriteEndpointPayload('/other?x=1', 'k'), '/other?x=1');
  assert.equal(rewriteEndpointPayload('{"jsonrpc":"2.0"}', 'k'), '{"jsonrpc":"2.0"}');
  assert.equal(rewriteEndpointPayload('not a path', 'k'), 'not a path');
});

test('only touches data lines of an SSE payload', () => {
  assert.equal(rewriteSseLine('event: endpoint\n', addKey), 'event: endpoint\n');
  assert.equal(rewriteSseLine('id: 42\n', addKey), 'id: 42\n');
  assert.equal(rewriteSseLine('\n', addKey), '\n');
  assert.equal(
    rewriteSseLine('data: /messages?sessionId=abc\n', addKey),
    'data: /messages?sessionId=abc&apiKey=k\n',
  );
  assert.equal(rewriteSseLine('data: /messages?sessionId=abc', addKey), 'data: /messages?sessionId=abc&apiKey=k');
});

test('rewrites the endpoint event even when chunks split mid-line', async () => {
  const text = await rewriteAll([
    'event: endp',
    'oint\ndata: /messages?sess',
    'ionId=abc\n\nevent: message\ndata: {"jsonrpc":"2.0"}\n\n',
  ]);

  assert.equal(
    text,
    'event: endpoint\ndata: /messages?sessionId=abc&apiKey=k\n\n' +
      'event: message\ndata: {"jsonrpc":"2.0"}\n\n',
  );
});

test('stops buffering once the endpoint event is out, so payloads keep streaming', async () => {
  const bigPayload = 'y'.repeat(200_000);
  const text = await rewriteAll([
    'event: endpoint\ndata: /messages?sessionId=abc\n\n',
    `event: message\ndata: ${bigPayload}`,
    '\n\n',
  ]);

  assert.match(text, /data: \/messages\?sessionId=abc&apiKey=k/);
  assert.ok(text.includes(bigPayload), 'large later payloads are forwarded verbatim');
});

test('keeps concurrent streams from corrupting each other', async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const original = 'event: message\ndata: {"text":"中"}\n\n';
  const bytes = encoder.encode(original);
  const splitAt = bytes.indexOf(0xe4);
  const twoBytePrefix = bytes.subarray(splitAt, splitAt + 2);
  const lastByte = bytes.subarray(splitAt + 2, splitAt + 3);

  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let aController = /** @type {any} */ (undefined);
  const aSource = new ReadableStream({
    start(controller) {
      aController = controller;
    },
  });
  const aReader = rewriteSseStream(aSource, (payload) => payload).getReader();

  // Stream A ends this chunk in the middle of a multibyte character. The
  // complete 'event: two' line before it is what makes this observable: seeing
  // that line proves the transform ran, so the decoder is now holding A's bytes.
  aController.enqueue(encoder.encode('event: one\ndata: hello\n\n'));
  aController.enqueue(Buffer.concat([encoder.encode('event: two\ndata: '), twoBytePrefix]));

  let aText = '';
  while (!aText.includes('event: two\n')) {
    const { value, done } = await aReader.read();
    if (done) break;
    aText += decoder.decode(value, { stream: true });
  }
  assert.ok(aText.includes('event: two\n'), 'stream A must reach the split point first');

  // A different client streams while A is mid-character.
  const bText = await new Response(rewriteSseStream(streamOf([original]), (payload) => payload)).text();

  aController.enqueue(Buffer.concat([lastByte, encoder.encode('\n')]));
  aController.close();
  for (;;) {
    const { value, done } = await aReader.read();
    if (done) break;
    aText += decoder.decode(value, { stream: true });
  }

  assert.equal(bText, original, 'stream B must decode exactly as if it were alone');
  assert.match(aText, /中/, 'stream A must keep its own multibyte character intact');
});

test('cancelling the relayed stream cancels the upstream stream', async () => {
  let cancelled = false;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages?sessionId=abc\n\n'));
    },
    cancel() {
      cancelled = true;
    },
  });

  const reader = rewriteSseStream(source, addKey).getReader();
  await reader.read();
  await reader.cancel();
  // Cancellation reaches the source through the pipe on a later tick.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cancelled, true, 'a disconnected client must not leave the upstream stream open');
});

test('flushes a trailing partial line on close', async () => {
  assert.equal(
    await rewriteAll(['event: endpoint\ndata: /messages?sessionId=abc']),
    'event: endpoint\ndata: /messages?sessionId=abc&apiKey=k',
  );
});
