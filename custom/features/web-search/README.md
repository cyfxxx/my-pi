# web-search — 网络搜索与抓取

私密搜索（SearXNG）+ HTTP 抓取，含搜索引擎直连降级。

## 注册面

工具：`web_search`、`fetch_url`、`web_fetch`。无命令 / 钩子。

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册 3 个工具 |
| `logic.ts` | 纯逻辑 barrel |
| `config.ts` | 端点/超时解析、settings.json 读取、`HTTP_TIMEOUT_MS` |
| `search.ts` | `searchWeb`（SearXNG）、`formatResponse`、`sanitizeMaxResults`、`truncate` |
| `fetch.ts` | `fetchUrl`（抓取 + 正文截断）、`searchDirect`（Bing 直连降级）、实体/跳转解码 |
| `concurrency.ts` | `createConcurrencyLimiter`、`batchFetch` |
| `types.ts` | 类型定义 |

## 配置（环境变量 > settings.json > 默认）

- `SEARXNG_URL` / `PI_WEB_TOOLKIT_SEARXNG_URL`：SearXNG 端点（默认 `http://127.0.0.1:8889`）。
- `PI_WEB_TOOLKIT_SEARCH_TIMEOUT`：搜索超时 ms（默认 30000）。
- settings.json 的 `extensions['pi-web-search']`（兼容旧 `pi-web-toolkit`）段：`searxng_url`、`search_timeout`。

## 约定

- SearXNG 不可用时自动降级到 `searchDirect`（Bing 直连），再失败才报错。
- 抓取正文有上限（`FETCH_BODY_CAP`），避免超大响应撑爆上下文。

## 相关

- SearXNG 部署：[../../scripts/README.md](../../../scripts/README.md)（`setup-external.sh` / `searxng-config.sh`）
- 功能层：[../README.md](../README.md)
