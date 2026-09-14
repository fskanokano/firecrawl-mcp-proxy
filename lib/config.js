/**
 * Runtime configuration for the Firecrawl MCP proxy.
 *
 * Exactly two environment variables are required: the proxy's own key and the
 * Firecrawl key it injects upstream. Both upstreams are the official Firecrawl
 * endpoints, so there is nothing else to point at. This module is also where a
 * request's dependencies (configuration + fetch implementation) are resolved,
 * so every endpoint wires up identically.
 */

const OFFICIAL_MCP_BASE = 'https://mcp.firecrawl.dev';
const OFFICIAL_API_BASE = 'https://api.firecrawl.dev';

/** Vercel Functions reject request bodies above 4.5 MB; stay just below it. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** Give the credit-usage call its own ceiling, well inside the function limit. */
export const CREDITS_TIMEOUT_MS = 15_000;

const PROXY_API_KEY_ENV = 'PROXY_API_KEY';
const FIRECRAWL_API_KEY_ENV = 'FIRECRAWL_API_KEY';

/**
 * @typedef {object} UpstreamEndpoints
 * @property {string} mcp        Firecrawl MCP surface (Streamable HTTP).
 * @property {string} sse        Legacy HTTP+SSE transport.
 * @property {string} messages   Legacy HTTP+SSE message relay.
 */

/**
 * @typedef {object} ProxyConfig
 * @property {string} proxyApiKey        Key clients must present to this proxy.
 * @property {string} firecrawlApiKey    Key injected into upstream requests.
 * @property {string} creditsUrl
 * @property {UpstreamEndpoints} upstream
 */

/**
 * @typedef {object} ConfigResolution
 * @property {boolean} ok                 False when the deployment is misconfigured.
 * @property {string[]} missing           Names of missing env variables.
 * @property {ProxyConfig} config         Always present, so handlers can still answer.
 */

/**
 * Everything an endpoint handler needs from its environment. `fetchImpl` exists
 * so tests can drive an endpoint without a network.
 *
 * @typedef {object} GatewayDeps
 * @property {Record<string, string | undefined>} [env]   Environment bag (defaults to process.env).
 * @property {typeof fetch} [fetchImpl]                    Fetch implementation (injected in tests).
 */

/**
 * One request's resolved configuration and the fetch implementation used to
 * reach Firecrawl.
 *
 * @typedef {object} ResolvedDeps
 * @property {ConfigResolution} resolved
 * @property {typeof fetch} fetchImpl
 */

/**
 * Trim a value, treating blank strings as absent.
 *
 * @param {string | undefined | null} value
 * @returns {string | undefined}
 */
function trimmed(value) {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result === '' ? undefined : result;
}

/**
 * Resolve the proxy configuration from an environment bag.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {ConfigResolution}
 */
export function resolveConfig(env = process.env) {
  /** @type {string[]} */
  const missing = [];

  const proxyApiKey = trimmed(env[PROXY_API_KEY_ENV]);
  if (!proxyApiKey) missing.push(PROXY_API_KEY_ENV);

  const firecrawlApiKey = trimmed(env[FIRECRAWL_API_KEY_ENV]);
  if (!firecrawlApiKey) missing.push(FIRECRAWL_API_KEY_ENV);

  return {
    ok: missing.length === 0,
    missing,
    config: {
      proxyApiKey: proxyApiKey ?? '',
      firecrawlApiKey: firecrawlApiKey ?? '',
      creditsUrl: `${OFFICIAL_API_BASE}/v2/team/credit-usage`,
      upstream: {
        mcp: `${OFFICIAL_MCP_BASE}/v2/mcp`,
        sse: `${OFFICIAL_MCP_BASE}/sse`,
        messages: `${OFFICIAL_MCP_BASE}/messages`,
      },
    },
  };
}

/**
 * Resolve the dependencies for one request: configuration plus the fetch
 * implementation used to reach Firecrawl.
 *
 * @param {GatewayDeps} [input]
 * @returns {ResolvedDeps}
 */
export function resolveDeps(input) {
  return {
    resolved: resolveConfig(input?.env ?? process.env),
    fetchImpl: input?.fetchImpl ?? fetch,
  };
}

/**
 * Human-readable explanation for a misconfigured deployment.
 *
 * @param {string[]} missing
 * @returns {string}
 */
export function misconfigurationMessage(missing) {
  return (
    `Proxy is not configured: set ${missing.join(', ')} in the Vercel project environment variables, ` +
    'then redeploy. PROXY_API_KEY is the secret your MCP clients present to this proxy; ' +
    'FIRECRAWL_API_KEY is injected upstream and never exposed to clients.'
  );
}
