/**
 * End-to-end smoke test.
 *
 * Boots the real gateway handlers on a local HTTP server (the same shapes Vercel
 * calls) and drives them against the live Firecrawl MCP service:
 *
 *   PROXY_API_KEY=dev-key FIRECRAWL_API_KEY=fc-... node scripts/smoke.js
 *
 * Without FIRECRAWL_API_KEY it still runs, using a placeholder key, which
 * verifies the auth gate, the masquerade and the transport plumbing (tool
 * *calls* then fail upstream as expected — that is reported, not hidden).
 */

import { createServer } from 'node:http';
import { Readable } from 'node:stream';

import { handleCredits } from '../lib/endpoints/credits.js';
import { handleMcp } from '../lib/endpoints/mcp.js';
import { handleLegacyMessage } from '../lib/endpoints/messages.js';
import { handleLegacySse } from '../lib/endpoints/sse.js';

const PROXY_API_KEY = process.env.PROXY_API_KEY ?? 'smoke-proxy-key';
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? 'fc-placeholder-key';
const USING_PLACEHOLDER_KEY = !process.env.FIRECRAWL_API_KEY;

const env = { PROXY_API_KEY, FIRECRAWL_API_KEY };
const PROTOCOL_VERSION = '2025-06-18';

/**
 * Adapt an incoming Node request to a Web `Request`. Node has already parsed the
 * headers, so only the body needs bridging.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Request}
 */
function toRequest(req) {
  const method = req.method ?? 'GET';
  /** @type {RequestInit} */
  const init = { method, headers: /** @type {Record<string, string>} */ (req.headers) };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), init);
}

/** @type {Record<string, (request: Request, input: object) => Promise<Response>>} */
const ROUTES = {
  '/mcp': handleMcp,
  '/v2/mcp': handleMcp,
  '/sse': handleLegacySse,
  '/messages': handleLegacyMessage,
  '/credits': handleCredits,
};

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function route(request) {
  const handler = ROUTES[new URL(request.url).pathname];
  return handler ? handler(request, { env }) : Promise.resolve(new Response('not found', { status: 404 }));
}

/**
 * The JSON-RPC payload carried by an SSE-framed MCP response.
 *
 * @param {string} text
 * @returns {any}
 */
function sseJson(text) {
  const data = /^data: (.*)$/m.exec(text)?.[1];
  return data ? JSON.parse(data) : undefined;
}

async function main() {
  const server = createServer(async (req, res) => {
    const response = await route(toRequest(req));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  /** @type {string[]} */
  const failures = [];

  /**
   * @param {string} name
   * @param {boolean} condition
   * @param {string} [detail]
   */
  const check = (name, condition, detail = '') => {
    console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures.push(name);
  };

  /**
   * One JSON-RPC call to the MCP endpoint through the proxy.
   *
   * @param {object} message
   * @param {Record<string, string>} [headers]
   */
  const mcpCall = (message, headers = {}) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
        ...headers,
      },
      body: JSON.stringify(message),
    });

  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1.0.0' },
    },
  };

  console.log(`Proxy under test: ${base} (upstream: live mcp.firecrawl.dev)`);
  if (USING_PLACEHOLDER_KEY) {
    console.log('ℹ️  FIRECRAWL_API_KEY not set — using a placeholder key (expected: upstream 401s on real work).');
  }
  console.log('');

  // 1. Auth gate
  const unauthenticated = await mcpCall(initialize);
  check('unauthenticated initialize is rejected with 401', unauthenticated.status === 401);

  const wrongKey = await mcpCall(initialize, { authorization: 'Bearer definitely-wrong' });
  check('wrong proxy key is rejected with 401', wrongKey.status === 401);

  // 2. Masquerade: the upstream's own serverInfo must come through untouched.
  const initialized = await mcpCall(initialize, { authorization: `Bearer ${PROXY_API_KEY}` });
  const initPayload = sseJson(await initialized.text());
  check(
    'initialize succeeds through the proxy',
    initialized.status === 200 && Boolean(initPayload?.result),
    `status ${initialized.status}`,
  );
  check(
    'serverInfo is reported as Firecrawl itself',
    initPayload?.result?.serverInfo?.name === 'firecrawl-fastmcp',
    String(initPayload?.result?.serverInfo?.name),
  );

  // 3. Tool surface
  const listResponse = await mcpCall(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { authorization: `Bearer ${PROXY_API_KEY}` },
  );
  /** @type {{ name: string }[]} */
  const tools = sseJson(await listResponse.text())?.result?.tools ?? [];
  const toolNames = tools.map((tool) => tool.name);
  check(
    'tools/list exposes the full Firecrawl tool set',
    toolNames.includes('firecrawl_scrape') && toolNames.includes('firecrawl_crawl'),
    `${toolNames.length} tools: ${toolNames.slice(0, 6).join(', ')}…`,
  );

  // 4. Legacy SSE transport
  const sse = await fetch(`${base}/sse?apiKey=${encodeURIComponent(PROXY_API_KEY)}`);
  const sseReader = sse.body?.getReader();
  const { value } = (await sseReader?.read()) ?? {};
  const firstEvent = value ? new TextDecoder().decode(value) : '';
  void sseReader?.cancel();
  check(
    'legacy SSE endpoint event points back at the proxy with the key',
    firstEvent.includes('/messages?sessionId=') && firstEvent.includes(`apiKey=${PROXY_API_KEY}`),
    firstEvent.split('\n')[1] ?? '',
  );

  // 5. Credits endpoint
  const credits = await fetch(`${base}/credits`, { headers: { 'x-api-key': PROXY_API_KEY } });
  const creditsBody = /** @type {Record<string, any> | undefined} */ (
    await credits.json().catch(() => undefined)
  );
  if (credits.status === 200) {
    check(
      'credits endpoint returns remaining credits',
      creditsBody?.data?.remainingCredits !== undefined,
      `remainingCredits=${creditsBody?.data?.remainingCredits}`,
    );
  } else {
    check(
      'credits endpoint rejects an invalid Firecrawl key',
      credits.status === 401 && USING_PLACEHOLDER_KEY,
      `status ${credits.status}${USING_PLACEHOLDER_KEY ? ' (placeholder key, expected)' : ''}`,
    );
  }

  // The SSE check leaves an upstream stream open by design; drop it so the
  // process can exit instead of hanging on the socket.
  server.closeAllConnections();
  server.close();

  console.log('');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} smoke check(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ all smoke checks passed');
  process.exit(0);
}

await main();
