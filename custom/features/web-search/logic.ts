/**
 * Web Search Feature — 纯逻辑出口（barrel，零 Pi 依赖）
 *
 * 大功能按职责分子包，`logic.ts` 仅作 barrel：
 *   - `config.ts`     端点/超时解析（settings.json / 环境变量）
 *   - `search.ts`     SearXNG 搜索（错误分类/重试、结果去重格式化）
 *   - `fetch.ts`      Bing 直搜（web_fetch）与轻量 HTTP GET（fetch_url）
 *   - `concurrency.ts` 并发限制器与批量 fetch
 */

export * from './config';
export * from './search';
export * from './fetch';
export * from './concurrency';
