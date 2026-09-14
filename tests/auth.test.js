import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectPresentedKeys, matchCredential } from '../lib/auth.js';

/**
 * @param {Record<string, string>} headers
 * @param {string} [query]
 * @returns {string[]}
 */
function keysFor(headers, query = '') {
  const url = new URL(`https://proxy.example/mcp${query}`);
  return collectPresentedKeys(new Request(url, { headers }), url);
}

test('collects candidates from every supported location', () => {
  assert.deepEqual(
    keysFor(
      {
        authorization: 'Bearer from-bearer',
        'x-api-key': 'from-x-api-key',
        'x-firecrawl-api-key': 'from-x-firecrawl',
      },
      '?apiKey=from-query',
    ),
    ['from-x-firecrawl', 'from-x-api-key', 'from-bearer', 'from-query'],
  );
});

test('parses the bearer scheme case-insensitively and ignores non-bearer headers', () => {
  assert.deepEqual(keysFor({ authorization: 'Bearer abc123' }), ['abc123']);
  assert.deepEqual(keysFor({ authorization: 'bearer   abc123  ' }), ['abc123']);
  assert.deepEqual(keysFor({ authorization: 'BEARER abc123' }), ['abc123']);
  assert.deepEqual(keysFor({ authorization: 'Basic abc123' }), []);
  assert.deepEqual(keysFor({ authorization: 'Bearer' }), []);
  assert.deepEqual(keysFor({ authorization: 'Bearer    ' }), []);
});

test('treats empty and whitespace credential slots as absent', () => {
  assert.deepEqual(keysFor({ 'x-api-key': '   ', authorization: 'Bearer ' }, '?apiKey=%20'), []);
});

test('returns the credential that matched, from any supported auth style', () => {
  const expected = 'proxy-secret';
  /** @type {Record<string, string>[]} */
  const cases = [
    { authorization: 'Bearer proxy-secret' },
    { 'x-api-key': 'proxy-secret' },
    { 'x-firecrawl-api-key': 'proxy-secret' },
  ];

  for (const headers of cases) {
    assert.equal(matchCredential(keysFor(headers), expected), expected, JSON.stringify(headers));
  }
  assert.equal(matchCredential(keysFor({}, '?apiKey=proxy-secret'), expected), expected);
});

test('returns nothing for wrong, empty and near-miss keys', () => {
  assert.equal(matchCredential(['nope'], 'proxy-secret'), undefined);
  assert.equal(matchCredential(['proxy-secre'], 'proxy-secret'), undefined);
  assert.equal(matchCredential(['PROXY-SECRET'], 'proxy-secret'), undefined);
  assert.equal(matchCredential([], 'proxy-secret'), undefined);
  assert.equal(matchCredential(['anything'], ''), undefined);
});

test('keeps a valid credential out of the running when another one also matches', () => {
  assert.equal(matchCredential(['junk', 'proxy-secret'], 'proxy-secret'), 'proxy-secret');
});
