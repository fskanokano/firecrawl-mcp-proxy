import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveConfig } from '../lib/config.js';
import { testEnv } from './support.js';

test('resolves the official upstream endpoints from the two required variables', () => {
  const { ok, missing, config } = resolveConfig(testEnv());

  assert.equal(ok, true);
  assert.deepEqual(missing, []);
  assert.equal(config.proxyApiKey, 'proxy-secret');
  assert.equal(config.firecrawlApiKey, 'fc-test-key');
  assert.deepEqual(config.upstream, {
    mcp: 'https://mcp.firecrawl.dev/v2/mcp',
    sse: 'https://mcp.firecrawl.dev/sse',
    messages: 'https://mcp.firecrawl.dev/messages',
  });
  assert.equal(config.creditsUrl, 'https://api.firecrawl.dev/v2/team/credit-usage');
});

test('reports both required variables when the environment is empty', () => {
  const { ok, missing } = resolveConfig({});

  assert.equal(ok, false);
  assert.deepEqual(missing, ['PROXY_API_KEY', 'FIRECRAWL_API_KEY']);
});

test('treats whitespace-only values as missing', () => {
  const { ok, missing } = resolveConfig(testEnv({ PROXY_API_KEY: '   ' }));

  assert.equal(ok, false);
  assert.deepEqual(missing, ['PROXY_API_KEY']);
});

test('trims surrounding whitespace from the keys', () => {
  const { config } = resolveConfig(testEnv({ FIRECRAWL_API_KEY: '  fc-spaced  ' }));

  assert.equal(config.firecrawlApiKey, 'fc-spaced');
});
