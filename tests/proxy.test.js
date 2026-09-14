import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RELAYED_UPSTREAM_HEADERS } from '../lib/client-headers.js';
import { handleCredits } from '../lib/endpoints/credits.js';
import { handleMcp } from '../lib/endpoints/mcp.js';
import { handleLegacyMessage } from '../lib/endpoints/messages.js';
import { handleLegacySse } from '../lib/endpoints/sse.js';
import { json, recordingFetch, stubUpstream, streamOf, testEnv } from './support.js';

const PROXY_KEY = 'proxy-secret';
const BASE = 'https://proxy.example';
const MCP_URL = `${BASE}/mcp`;

/** The `endpoint` event the upstream opens a legacy SSE stream with. */
const SSE_ENDPOINT_EVENT = 'event: endpoint\ndata: /messages?sessionId=abc\n\n';
const SSE_STREAM_HEADERS = { 'content-type': 'text/event-stream' };

/**
 * @param {typeof fetch} fetchImpl
 * @param {Record<string, string | undefined>} [env]
 */
const deps = (fetchImpl, env = testEnv()) => ({ env, fetchImpl });

/**
 * A request shaped as a client sends it: POST with a JSON-RPC body unless the
 * method says otherwise, carrying no proxy credential.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [init]
 * @returns {Request}
 */
function guest(url, init = {}) {
  const method = init.method ?? 'POST';
  return new Request(url, {
    method,
    body: method === 'POST' ? (init.body ?? '{}') : undefined,
    headers: init.headers,
  });
}

/**
 * A request that presents the proxy key in the standard header.
 *
 * @param {string} [url]
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [init]
 */
const authed = (url = MCP_URL, init = {}) =>
  guest(url, { ...init, headers: { authorization: `Bearer ${PROXY_KEY}`, ...init.headers } });

/** A GET that opens the legacy SSE stream, the key in the query as old clients send it. */
const openSse = (query = '') => guest(`${BASE}/sse${query}`, { method: 'GET' });

/** A GET of the credits endpoint, the key in `x-api-key`. */
const credits = (query = '') =>
  guest(`${BASE}/credits${query}`, { method: 'GET', headers: { 'x-api-key': PROXY_KEY } });

/* ------------------------------------------------------------------ auth gate */

test('rejects a request without any credential', async () => {
  const { impl, calls } = stubUpstream('nope');
  const response = await handleMcp(guest(MCP_URL), deps(impl));

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0, 'unauthorized requests never reach upstream');
  const payload = await json(response);
  assert.equal(payload.success, false);
  assert.equal(payload.error, 'missing_api_key');
  assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/);
});

test('rejects a wrong proxy key without contacting upstream', async () => {
  const { impl, calls } = stubUpstream('nope');
  const response = await handleMcp(
    authed(MCP_URL, { headers: { authorization: 'Bearer wrong' } }),
    deps(impl),
  );

  assert.equal(response.status, 401);
  assert.equal((await json(response)).error, 'invalid_api_key');
  assert.equal(calls.length, 0);
});

test('never echoes either key in authentication failures', async () => {
  const { impl } = stubUpstream('nope');
  const response = await handleMcp(
    authed(MCP_URL, { headers: { authorization: 'Bearer fc-test-key' } }),
    deps(impl),
  );

  const text = await response.text();
  assert.equal(response.status, 401);
  assert.doesNotMatch(text, /fc-test-key|proxy-secret/);
});

test('treats an empty or whitespace credential as absent', async () => {
  const { impl, calls } = stubUpstream('ok');
  const cases = [
    `${MCP_URL}?apiKey=`,
    `${MCP_URL}?apiKey=%20%20`,
    `${MCP_URL}?apiKey=&apiKey=${PROXY_KEY}`,
  ];

  for (const url of cases) {
    // An empty `Authorization: Bearer ` header must not count as a credential either.
    const request = guest(url, { headers: { authorization: 'Bearer ', 'x-api-key': '' } });
    const response = await handleMcp(request, deps(impl));
    assert.equal(response.status, 401, url);
  }
  assert.equal(calls.length, 0, 'no unauthenticated request may reach upstream');
});

test('accepts the proxy key from every supported location', async () => {
  /** @type {{ headers: Record<string, string>, url: string }[]} */
  const styles = [
    { headers: { authorization: `Bearer ${PROXY_KEY}` }, url: MCP_URL },
    { headers: { 'x-api-key': PROXY_KEY }, url: MCP_URL },
    { headers: { 'x-firecrawl-api-key': PROXY_KEY }, url: MCP_URL },
    { headers: {}, url: `${MCP_URL}?apiKey=${PROXY_KEY}` },
  ];

  for (const style of styles) {
    const { impl, calls } = stubUpstream('ok');
    const response = await handleMcp(
      guest(style.url, { headers: { ...style.headers, 'content-type': 'application/json' } }),
      deps(impl),
    );
    assert.equal(response.status, 200, JSON.stringify(style.headers));
    assert.equal(calls.length, 1);
  }
});

/* ------------------------------------------------------------ configuration */

test('answers 500 with guidance when the deployment is misconfigured', async () => {
  const { impl, calls } = stubUpstream('nope');
  const response = await handleMcp(guest(MCP_URL), { env: {}, fetchImpl: impl });

  assert.equal(response.status, 500);
  assert.equal(calls.length, 0);
  const payload = await json(response);
  assert.equal(payload.error, 'proxy_misconfigured');
  assert.match(payload.error_description, /PROXY_API_KEY/);
  assert.match(payload.error_description, /FIRECRAWL_API_KEY/);
});

/* --------------------------------------------------------------- forwarding */

test('relays the full MCP surface with the server-side Firecrawl key injected', async () => {
  const upstreamBody = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
  const { impl, calls } = stubUpstream(upstreamBody, {
    headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' },
  });

  const response = await handleMcp(
    authed(MCP_URL, {
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'mcp-session-id': 'client-session',
        cookie: 'session=leaky',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    }),
    deps(impl),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mcp.firecrawl.dev/v2/mcp');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fc-test-key');
  assert.equal(calls[0].headers.get('cookie'), null);
  assert.equal(calls[0].headers.get('x-api-key'), null);
  assert.equal(calls[0].headers.get('x-firecrawl-api-key'), null);
  assert.equal(calls[0].headers.get('mcp-protocol-version'), '2025-06-18');
  assert.equal(calls[0].headers.get('mcp-session-id'), 'client-session');
  assert.equal(response.headers.get('mcp-session-id'), 'sess-1');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), upstreamBody);
});

test('forwards the JSON-RPC body byte for byte, including multibyte content', async () => {
  const { impl, calls } = stubUpstream();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'x', arguments: { text: '中文字符 🚀 ünïcøde', url: 'https://例え.jp/路径?q=值' } },
  });

  await handleMcp(
    authed(MCP_URL, { headers: { 'content-type': 'application/json' }, body }),
    deps(impl),
  );

  const forwarded = calls[0].init.body;
  assert.ok(forwarded instanceof ArrayBuffer);
  assert.equal(new TextDecoder().decode(forwarded), body);
});

test('sends nothing but the allowlisted headers upstream', async () => {
  const { impl, calls } = stubUpstream();
  await handleMcp(
    authed(MCP_URL, {
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
        'x-vercel-id': 'abc',
        'cf-connecting-ip': '203.0.113.9',
      },
    }),
    deps(impl),
  );

  const names = [...calls[0].headers.keys()].sort();
  assert.deepEqual(names, ['authorization', 'content-type']);
});

test('keeps a GET request body empty and streams the response through', async () => {
  const { impl, calls } = stubUpstream(streamOf(['event: ping\n', 'data: {}\n\n']), {
    headers: { 'content-type': 'text/event-stream' },
  });

  const response = await handleMcp(authed(MCP_URL, { method: 'GET' }), deps(impl));

  assert.equal(calls[0].init.body, undefined);
  assert.equal(await response.text(), 'event: ping\ndata: {}\n\n');
});

test('passes upstream status and retry hints back unchanged', async () => {
  const { impl } = recordingFetch(
    () =>
      Response.json(
        { error: 'rate limited' },
        { status: 429, headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0' } },
      ),
  );

  const response = await handleMcp(authed(MCP_URL), deps(impl));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(response.headers.get('x-ratelimit-remaining'), '0');
  assert.equal((await json(response)).error, 'rate limited');
});

test('keeps the Allow header on a method the upstream rejects', async () => {
  const { impl } = stubUpstream('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });

  const response = await handleMcp(authed(MCP_URL, { method: 'GET' }), deps(impl));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST', 'RFC 9110 requires Allow on a 405');
});

test('answers 502 when upstream cannot be reached', async () => {
  const { impl } = recordingFetch(() => {
    throw new TypeError('fetch failed');
  });

  const response = await handleMcp(authed(MCP_URL), deps(impl));

  assert.equal(response.status, 502);
  assert.equal((await json(response)).error, 'upstream_unavailable');
});

test('rejects oversized bodies with 413 before contacting upstream', async () => {
  const { impl, calls } = stubUpstream();
  const response = await handleMcp(
    authed(MCP_URL, { body: 'x'.repeat(4 * 1024 * 1024 + 1) }),
    deps(impl),
  );

  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

test('rejects unsupported methods with an Allow header', async () => {
  const { impl, calls } = stubUpstream();
  const response = await handleMcp(authed(MCP_URL, { method: 'PUT' }), deps(impl));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST, DELETE, OPTIONS');
  assert.equal(calls.length, 0);
});

/**
 * Every route with its own method set, that set as a client sees it, and a
 * method the route rejects. One table so a route whose preflight and 405
 * disagree cannot pass: the preflight list is derived from the route's own
 * declaration, and this asserts both surfaces against it at once.
 */
/**
 * @typedef {[path: string, handler: (request: Request, input?: import('../lib/config.js').GatewayDeps) => Promise<Response>, allow: string, rejected: string]} RouteMethods
 */

/** @type {RouteMethods[]} */
const ROUTE_METHODS = [
  ['/mcp', handleMcp, 'GET, POST, DELETE, OPTIONS', 'PUT'],
  ['/v2/mcp', handleMcp, 'GET, POST, DELETE, OPTIONS', 'PUT'],
  ['/sse', handleLegacySse, 'GET, OPTIONS', 'POST'],
  ['/messages', handleLegacyMessage, 'POST, OPTIONS', 'GET'],
  ['/credits', handleCredits, 'GET, OPTIONS', 'POST'],
];

test('advertises each route its own methods, in preflight and on rejection alike', async () => {
  for (const [path, handler, allow, rejected] of ROUTE_METHODS) {
    const { impl, calls } = stubUpstream();
    const origin = { origin: 'https://app.example' };

    const preflight = await handler(guest(`${BASE}${path}`, { method: 'OPTIONS', headers: origin }), deps(impl));
    assert.equal(preflight.status, 204, `${path} preflight status`);
    assert.equal(preflight.headers.get('access-control-allow-methods'), allow, `${path} preflight methods`);

    const rejection = await handler(guest(`${BASE}${path}`, { method: rejected, headers: origin }), deps(impl));
    assert.equal(rejection.status, 405, `${path} rejects ${rejected}`);
    assert.equal(rejection.headers.get('allow'), allow, `${path} 405 Allow`);
    assert.equal(
      rejection.headers.get('access-control-allow-methods'),
      null,
      `${path} must not advertise a method list outside a preflight`,
    );
    assert.equal(calls.length, 0, `${path} must answer without touching upstream`);
  }
});

test('answers CORS preflight without requiring a credential', async () => {
  const { impl, calls } = stubUpstream();
  const response = await handleMcp(
    guest(MCP_URL, { method: 'OPTIONS', headers: { origin: 'https://app.example' } }),
    deps(impl),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /mcp-session-id/);
  assert.equal(calls.length, 0);
});

test('exposes exactly the headers it relays', async () => {
  const { impl } = stubUpstream();
  const response = await handleMcp(
    guest(MCP_URL, { method: 'OPTIONS', headers: { origin: 'https://app.example' } }),
    deps(impl),
  );

  const exposed = (response.headers.get('access-control-expose-headers') ?? '')
    .split(',')
    .map((name) => name.trim());
  assert.deepEqual(exposed.sort(), [...RELAYED_UPSTREAM_HEADERS].sort());
});

/* ------------------------------------------------------------ legacy SSE */

test('rewrites the legacy SSE endpoint event and echoes a query credential', async () => {
  const upstreamBody =
    'event: endpoint\ndata: /messages?sessionId=6f4ca523\n\n' +
    'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\n\n';
  const { impl, calls } = stubUpstream(upstreamBody, {
    headers: { 'content-type': 'text/event-stream' },
  });

  const response = await handleLegacySse(openSse(`?apiKey=${PROXY_KEY}`), deps(impl));
  const text = await response.text();

  assert.equal(calls[0].url, 'https://mcp.firecrawl.dev/sse');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fc-test-key');
  assert.match(text, /data: \/messages\?sessionId=6f4ca523&apiKey=proxy-secret/);
  assert.match(text, /notifications\/message/);
});

test('leaves the legacy endpoint untouched for header-based clients', async () => {
  const { impl } = stubUpstream(SSE_ENDPOINT_EVENT, { headers: SSE_STREAM_HEADERS });

  const response = await handleLegacySse(authed(`${BASE}/sse`, { method: 'GET' }), deps(impl));

  assert.match(await response.text(), /data: \/messages\?sessionId=abc\n/);
});

test('does not reflect a stray query credential when the client used a header', async () => {
  const { impl } = stubUpstream(SSE_ENDPOINT_EVENT, { headers: SSE_STREAM_HEADERS });

  const response = await handleLegacySse(
    authed(`${BASE}/sse?apiKey=not-the-proxy-key`, { method: 'GET' }),
    deps(impl),
  );

  assert.doesNotMatch(
    await response.text(),
    /apiKey=/,
    'a bogus ?apiKey= must not be echoed into the stream',
  );
});

test('leaves a rejected upstream body untransformed', async () => {
  const { impl } = stubUpstream(SSE_ENDPOINT_EVENT, { status: 401, headers: SSE_STREAM_HEADERS });

  const response = await handleLegacySse(openSse(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 401);
  assert.equal(await response.text(), SSE_ENDPOINT_EVENT, 'an error body must be relayed verbatim');
});

test('guards the legacy SSE stream with the proxy key', async () => {
  const { impl, calls } = stubUpstream('');
  const response = await handleLegacySse(guest(`${BASE}/sse`, { method: 'GET' }), deps(impl));

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('relays legacy SSE messages, dropping the proxy key from the query', async () => {
  const { impl, calls } = stubUpstream('Accepted', {
    status: 202,
    headers: { 'content-type': 'text/plain' },
  });

  const response = await handleLegacyMessage(
    guest(`${BASE}/messages?sessionId=abc&apiKey=${PROXY_KEY}`, {
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    }),
    deps(impl),
  );

  assert.equal(response.status, 202);
  assert.equal(calls[0].url, 'https://mcp.firecrawl.dev/messages?sessionId=abc');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fc-test-key');
  assert.equal(await response.text(), 'Accepted');
});

test('rejects legacy messages without a session id', async () => {
  const { impl, calls } = stubUpstream('');
  const response = await handleLegacyMessage(authed(`${BASE}/messages`), deps(impl));

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await json(response)).error, 'missing_session_id');
});

/* ---------------------------------------------------------------- credits */

test('returns Firecrawl credit usage verbatim with a freshness stamp', async () => {
  const upstream = {
    success: true,
    data: {
      remainingCredits: 1000,
      planCredits: 500000,
      billingPeriodStart: '2025-01-01T00:00:00Z',
      billingPeriodEnd: '2025-01-31T23:59:59Z',
    },
  };
  const { impl, calls } = recordingFetch(() => Response.json(upstream));

  const response = await handleCredits(credits(), deps(impl));

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://api.firecrawl.dev/v2/team/credit-usage');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fc-test-key');

  const payload = await json(response);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.data, upstream.data);
  assert.match(payload.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('requires the proxy key for credit usage', async () => {
  const { impl, calls } = recordingFetch(() => Response.json({}));
  const response = await handleCredits(guest(`${BASE}/credits`, { method: 'GET' }), deps(impl));

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('relays a rejected Firecrawl key instead of masking it', async () => {
  const { impl } = recordingFetch(
    () => Response.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 }),
  );

  const response = await handleCredits(credits(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 401);
  assert.equal((await json(response)).error, 'Unauthorized: Invalid token');
});

test('relays non-JSON upstream bodies untouched', async () => {
  const { impl } = stubUpstream('<html>gateway</html>', {
    headers: { 'content-type': 'text/html' },
  });

  const response = await handleCredits(credits(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html');
  assert.equal(await response.text(), '<html>gateway</html>');
});

test('answers 504 when the credit usage request times out', async () => {
  const { impl } = recordingFetch(() => {
    // The exact shape `AbortSignal.timeout` produces when it fires.
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });

  const response = await handleCredits(credits(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 504);
  assert.equal((await json(response)).error, 'upstream_timeout');
});

test('answers 502 when the credit usage body fails mid-read', async () => {
  const broken = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"success":true,'));
      controller.error(new Error('connection reset'));
    },
  });
  const { impl } = stubUpstream(broken, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const response = await handleCredits(credits(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 502);
  assert.equal((await json(response)).error, 'upstream_unavailable');
});

test('gives each concurrent request its own credential', async () => {
  /** @type {(string | null)[]} */
  const seen = [];
  const { impl } = recordingFetch((call) => {
    seen.push(call.headers.get('authorization'));
    return new Promise((resolve) => setTimeout(() => resolve(Response.json({ success: true })), 5));
  });

  await Promise.all([
    handleCredits(credits(), { env: testEnv({ FIRECRAWL_API_KEY: 'fc-one' }), fetchImpl: impl }),
    handleCredits(credits(), { env: testEnv({ FIRECRAWL_API_KEY: 'fc-two' }), fetchImpl: impl }),
  ]);

  assert.deepEqual(
    seen.sort(),
    ['Bearer fc-one', 'Bearer fc-two'],
    'a per-request config must never be shared between requests',
  );
});

test('answers 502 when the credits upstream is unreachable', async () => {
  const { impl } = recordingFetch(() => {
    throw new TypeError('fetch failed');
  });

  const response = await handleCredits(credits(`?apiKey=${PROXY_KEY}`), deps(impl));

  assert.equal(response.status, 502);
});
