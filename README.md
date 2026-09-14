# Firecrawl MCP 代理（Vercel）

把 Firecrawl 官方 MCP 服务变成你自己的：客户端只持有**你自己的代理 Key**，Firecrawl 的 Key 永远留在服务端。
25 个工具、工具描述、`serverInfo`、连接语义全部与官方一致，对 MCP 客户端来说它就是 Firecrawl MCP。

- 🔑 **只需要 2 个环境变量**：`PROXY_API_KEY` + `FIRECRAWL_API_KEY`
- 🧰 **满血功能**：透明转发官方 MCP，官方新增工具/修复自动生效（当前 = 25 个工具全量）
- 🔁 **两种传输**：Streamable HTTP（`/mcp`，推荐）+ 旧版 SSE（`/sse`、`/messages`；上游侧几乎接不通，见端点一览）
- 💳 **额外余额接口**：`GET /credits` 查询剩余额度
- 🪶 **零依赖、零构建配置**：从 GitHub 导入即可部署，无需选框架、无需构建命令

---

## 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/fskanokano/firecrawl-mcp-proxy&project-name=firecrawl-mcp-proxy&repository-name=firecrawl-mcp-proxy&env=PROXY_API_KEY,FIRECRAWL_API_KEY)

按钮指向的就是下面这条链接，已预填仓库、项目名与两个环境变量的**名字**，点开即用（打开页面不需要登录，但真正创建项目需要 Vercel 账号，并授权它读取该私有仓库）：

```text
https://vercel.com/new/clone?repository-url=https://github.com/fskanokano/firecrawl-mcp-proxy&project-name=firecrawl-mcp-proxy&repository-name=firecrawl-mcp-proxy&env=PROXY_API_KEY,FIRECRAWL_API_KEY
```

两点开箱前就该知道（都不是占位符，不需要你替换任何东西）：

- **本仓库目前是 private**（`https://github.com/fskanokano/firecrawl-mcp-proxy`）。第一次用上面的链接时，Vercel 会要求你**授权它访问 GitHub**（安装 GitHub App / 授予该仓库权限）——private 仓库必须走这一步才能被导入；未登录或未授权的情况下，GitHub 对 private 仓库一律返回 404 而不是 403，这是 GitHub 的行为，不是链接写错了。若你想在**自己的** GitHub 账号下部署，先按下文 clone 再推到你自己的仓库，把链接里的 `repository-url` 换成你的地址。
- **两个 Key 的值不在 URL 里，而是在导入时填入。** 为了避免把秘密写进 URL、浏览器历史和 Vercel 日志，上面只预填了变量名 `PROXY_API_KEY`、`FIRECRAWL_API_KEY`；值请在导入表单的 **Environment Variables** 里粘贴，再点 Deploy。

把仓库拿到本地（private 仓库需要 GitHub 登录凭据，或先用 `gh auth login` 授权）：

```bash
git clone https://github.com/fskanokano/firecrawl-mcp-proxy.git
cd firecrawl-mcp-proxy
```

手动导入同样简单：

1. Vercel → **Add New… → Project → Import Git Repository**，选中 `fskanokano/firecrawl-mcp-proxy`（private 仓库首次需要授权 GitHub 访问；想换成你自己的账号，先 clone 再推过去即可）。
2. Framework Preset 保持 **Other**，Build Command / Output Directory / Install Command **全部留空**（本仓库不需要构建）。
3. 在 **Environment Variables** 里填两个变量（值从下面的表格里取），然后 Deploy。
4. 部署完成后访问 `https://<你的项目>.vercel.app/mcp`（不带任何 Key）：返回 `401 {"success":false,"error":"missing_api_key",…}` 就说明代理已经跑起来了；若返回 `500 proxy_misconfigured`，则是环境变量没配或名字拼错。

> 下文所有 `https://<你的项目>.vercel.app/…` 里的 `<你的项目>` 是你**自己的** Vercel 项目名，部署之后才存在，因此无法预先写成可点的链接；本文档里其余写出的 URL 都是可直接打开的真实地址（需要登录的会注明）。

### 两个环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PROXY_API_KEY` | ✅ | 代理自己的密钥，客户端用它连接本代理。建议 `openssl rand -hex 32` 生成 |
| `FIRECRAWL_API_KEY` | ✅ | Firecrawl 的 API Key（`fc-…`），由代理注入上游，永不下发给客户端。在 https://www.firecrawl.dev/app/api-keys 获取（该地址会跳到 Firecrawl 的登录页 `/signin`，**需要登录 Firecrawl 账号**才能创建 Key） |

就这两个。上游地址固定指向官方（`https://mcp.firecrawl.dev` 与 `https://api.firecrawl.dev`），没有别的开关。这两个是**服务端接口**而不是给人用的页面：直接 GET `https://api.firecrawl.dev` 会返回 `{"message":"Firecrawl API",…}`，在浏览器里打开 `https://mcp.firecrawl.dev` 会跳到官方 MCP 文档页——都属正常，不代表代理出问题。

---

## 客户端配置

把 `<你的项目>` 换成你的 Vercel 域名，`<PROXY_API_KEY>` 换成代理 Key。四种传 Key 的方式都支持：
`Authorization: Bearer`、`x-api-key`、`x-firecrawl-api-key`、URL 里的 `?apiKey=`。

### 通用（推荐：Streamable HTTP）

```json
{
  "mcpServers": {
    "firecrawl": {
      "type": "http",
      "url": "https://<你的项目>.vercel.app/mcp",
      "headers": { "Authorization": "Bearer <PROXY_API_KEY>" }
    }
  }
}
```

### Cursor / VS Code / Claude Code 等

- **Cursor**：Settings → MCP → Add new MCP server，Type 选 `http`（或 `streamable-http`），URL 填 `https://<你的项目>.vercel.app/mcp`，Headers 加 `Authorization: Bearer <PROXY_API_KEY>`。
- **Claude Code**：`claude mcp add --transport http firecrawl https://<你的项目>.vercel.app/mcp --header "Authorization: Bearer <PROXY_API_KEY>"`
- **VS Code / 其他 IDE**：在 `mcp.json` 里等价写成 `{"type":"http","url":"…/mcp","headers":{"Authorization":"Bearer …"}}`。

### 老客户端（只支持 SSE）

```json
{
  "mcpServers": {
    "firecrawl": { "url": "https://<你的项目>.vercel.app/sse?apiKey=<PROXY_API_KEY>" }
  }
}
```

代理会重写 SSE 的 `endpoint` 事件，让后续消息 POST 回你自己的域名（`/messages?sessionId=…`），无需额外配置——这点用官方 MCP SDK（`@modelcontextprotocol/sdk@1.30.0` 的 `SSEClientTransport`）验证过：客户端确实按重写后的地址回 POST，并把 `?apiKey=` 原样带上。
注意：官方这套旧版传输依赖上游的会话亲和性，实际几乎接不通。**成对运行的 8 组（直连官方 `/sse` 与经本代理各一次）两侧都是 0/8**，均返回上游 `400 "No active transport"`；21 次经代理的尝试中只有 1 次完成握手。失败原因是上游侧实例没有持有该 session，与本代理无关。能用 Streamable HTTP 的客户端请用 `/mcp`。

### 纯 HTTP 调用（脚本 / n8n / 自研 Agent）

```bash
curl -sS https://<你的项目>.vercel.app/mcp \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## 端点一览

下表的「实测」列写明该端点在开发环境中被真实调用过的方式；上游不支持的方法本代理会原样透传上游的状态码，不会假装成功。

| 路径 | 可用的方法 | 说明 | 实测 |
| --- | --- | --- | --- |
| `/mcp`、`/v2/mcp` | **POST** | MCP（25 个工具），Streamable HTTP。上游是无状态的：`GET` 返回 **405**（带上游的 `Allow: POST`）、`DELETE` 返回 **400**（无会话可终止），两者均由本代理原样透传 | POST ✅（`initialize` + `tools/list` 真实上游 25 个工具）；GET/DELETE 实测为 405/400 透传 |
| `/sse` | GET | 旧版 SSE 传输（`endpoint` 事件已重写为回指本代理） | ✅ 实测：流可建立、endpoint 已重写，且官方 SDK 客户端确实按重写后的地址回 POST |
| `/messages` | POST | 旧版 SSE 的消息回传端点，需 `?sessionId=…` | ⚠️ 实测**几乎不可用**：官方 SDK 成对运行 8 组里直连官方与经本代理都是 **0/8**，全部返回上游 `400 "No active transport"`（21 次经代理尝试仅 1 次握手成功），**直连官方同样失败**，属上游会话亲和性问题；请用 Streamable HTTP（`/mcp`） |
| `/credits` | GET | 剩余额度查询 | 无效 Key 的 `401` 透传 ✅ 实测；**返回额度需要有效的 `FIRECRAWL_API_KEY`**，无有效 Key 时必然 401 |

未提供（有意为之）：官方的 `/v2/mcp-search` 只读搜索专线是 **OAuth-only** 面，实测用 `fc-` Key 直连也会被拒（`401 invalid_token / OAuth access token required`），因此在「只用两个环境变量 + API Key」的前提上它永远不可用，本代理不暴露该路径；`/v2/mcp-oauth` 同理不暴露（本代理不做 OAuth 登录流程）。

## 余额查询接口

```bash
curl -sS https://<你的项目>.vercel.app/credits \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

返回 Firecrawl 官方结构（原样透传），并附加一个 `checkedAt` 时间戳：

```json
{
  "success": true,
  "data": {
    "remainingCredits": 1000,
    "planCredits": 500000,
    "billingPeriodStart": "2026-09-01T00:00:00Z",
    "billingPeriodEnd": "2026-09-30T23:59:59Z"
  },
  "checkedAt": "2026-09-14T12:00:00.000Z"
}
```

Firecrawl 拒绝该 Key 时，会原样返回 `401 {"success":false,"error":"Unauthorized: Invalid token"}` —— 这也是判断 `FIRECRAWL_API_KEY` 是否有效的最快方式。

## 支持的工具（25 个）

`scrape`、`map`、`search`、`search_feedback`、`feedback`、`crawl`、`check_crawl_status`、`parse`、`agent`、`agent_status`、`interact`、`interact_stop`、`developer_search`、`research_search_papers`、`research_inspect_paper`、`research_related_papers`、`research_read_paper`、`monitor_create` / `list` / `get` / `update` / `run` / `delete` / `checks` / `check`。

这份清单直接来自官方 MCP，官方增删工具这里会同步变化，无需升级本仓库。

---

## 部署限制与注意事项

- **函数最长执行时间（`vercel.json` 已设为 `maxDuration: 300`）**
  - Hobby / Pro 默认上限都是 300 秒；Pro / Enterprise 可提高到 **800 秒**（`vercel.json` 里把 `api/*.js` 的 `maxDuration` 改成 `800`），付费团队在 beta 中最高 **1800 秒**。
  - 超大 crawl 可能超过 300 秒，此时改用 `firecrawl_map` + 单页 `firecrawl_scrape`，或用 `firecrawl_crawl` 拿到 `id` 后用 `firecrawl_check_crawl_status` 续查，不必让一个请求一直挂着。
- **无状态**：上游会话语义（含 `mcp-session-id`）原样透传，但本代理不保存任何状态，因此不依赖 KV、数据库或 Redis。
- **请求体上限 4 MB**：Vercel 本身限制 4.5 MB，代理在 4 MB 处直接返回 `413`。
- **`/parse` 的本地文件流程**：官方托管 MCP 不支持读取客户端本地文件，需按其两段式上传流程（`filePath` → 上传 → `uploadRef`）操作，与本代理无关。
- **区域与网络**：默认部署在 Vercel 默认区域，若主要调用方在亚洲，可在项目设置里把 Functions 区域调到更近的节点。

## 本地开发

```bash
npm install          # 仅安装 typescript / @types/node（仅用于类型检查，运行时零依赖）

npm test             # 52 个单元测试（node:test，覆盖鉴权、头部隔离、转发、错误映射、SSE 重写与并发隔离、余额接口）
npm run typecheck    # 用 JSDoc 类型做静态检查（tsc --noEmit，不产出文件）

# 端到端冒烟：本地起服务 + 真实调用官方上游
PROXY_API_KEY=dev-key FIRECRAWL_API_KEY=fc-xxxxx node scripts/smoke.js
```

`scripts/smoke.js` 会真的连官方上游，检查：鉴权拦截、`serverInfo` 伪装、工具数量、SSE 重写、余额接口状态码。
不设 `FIRECRAWL_API_KEY` 也能跑（用占位 Key，工具调用会按预期被上游拒绝）。

### 为什么用 JavaScript 而不是 TypeScript

Vercel 的 `/api` 函数构建器是**逐文件转译 + 按依赖追踪**，不会打包，`.ts` 的相对导入在部署后经常变成 `ERR_MODULE_NOT_FOUND`。
本仓库用原生 ESM + 精确文件名（`./lib/relay.js` 就是磁盘上的文件），本地跑的和线上跑的是同一份代码；类型安全通过 JSDoc + `tsc --checkJs` 保证。
（该结论已在本地用 `@vercel/node` 真实构建器验证：4 个函数全部构建为 `Lambda`，`lib/*.js` 均被正确追踪进产物。）

## 目录结构

```
api/                  Vercel Functions（每个文件只做一件事：把请求交给对应端点）
lib/config.js         环境变量 → 配置；一个请求的依赖（配置 + fetch）
lib/auth.js           代理 Key 的提取；返回“哪个凭证通过了”的恒定时间比对
lib/gate.js           请求准入：配置、方法、凭证，并把通过校验的凭证交给端点
lib/client-headers.js 客户端响应头策略的唯一归属：转发哪些头、浏览器可读哪些头、CORS/no-store
lib/upstream.js       上游请求的唯一归属：凭证呈现、头部白名单、请求体上限与读取、发送
lib/relay.js          回包的唯一归属：不缓冲地流式回传上游响应
lib/forward.js        转发路径的唯一归属：发送 → 归类失败（超时/不可达）→ 回传
lib/http.js           本代理自己发明的响应形状（JSON 错误包、预检、405/413/500/502/504）
lib/sse-rewrite.js    旧版 SSE 的 endpoint 事件重写
lib/endpoints/        mcp.js / sse.js / messages.js / credits.js
tests/                node:test 单元测试
scripts/smoke.js      端到端冒烟脚本
vercel.json           路由别名 + 函数时长
```

## 安全建议

- 客户端只拿到 `PROXY_API_KEY`；Firecrawl Key 只存在于 Vercel 环境变量里，任何响应体和错误信息都不会泄露它（已有测试覆盖）。
- 代理会剥离客户端携带的 `authorization` / `x-api-key` / `x-firecrawl-api-key` / `cookie`，只放行 MCP 必需的少数头部（`content-type`、`accept`、`mcp-session-id`、`mcp-protocol-version`、`last-event-id`），避免凭证被转交或伪造；客户端的 `user-agent` / `accept-language` 不会转发给 Firecrawl。
- 怀疑泄露就轮换 `PROXY_API_KEY`（改环境变量后 Redeploy 即可），不需要重新生成客户端配置里的 URL。
- 用 `?apiKey=` 传 Key 会出现在 URL 和访问日志里，仅在客户端确实无法设置请求头时使用；优先用 `Authorization` 头。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `401 invalid_api_key` | 客户端带的不是本代理的 `PROXY_API_KEY`（注意：不要填 Firecrawl 的 `fc-…`） |
| `500 proxy_misconfigured` | 环境变量没配或名字拼错，改完记得 **Redeploy** |
| 工具能列出来但调用报 `CREDENTIAL_INVALID` | `FIRECRAWL_API_KEY` 无效或已撤销，用 `/credits` 验证 |
| 部署后 404 | 确认仓库里存在 `api/` 目录且 Framework Preset 是 Other、没有额外的 Output Directory 设置 |
| 老客户端连不上 `/mcp` | 旧版 SSE（`/sse?apiKey=…`）因上游会话亲和性问题几乎接不通（见端点一览），本代理无法规避；建议把客户端升级到支持 Streamable HTTP 的版本 |

## 免责声明

本项目是自托管的代理，与 Firecrawl 官方无隶属关系，仅按官方公开的 MCP/REST 接口转发请求；Firecrawl 及相关标识归其所有者。请遵守 Firecrawl 的服务条款与配额限制。

MIT License.
