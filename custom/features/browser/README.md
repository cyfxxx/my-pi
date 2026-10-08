# browser — 浏览器自动化

基于 playwright-core 的浏览器自动化（导航/截图/点击/输入/提取/网络/下载上传/PDF 等），进程内复用浏览器实例。

## 注册面

- 工具：`browser_navigate`、`browser_screenshot`、`browser_click`、`browser_type`、`browser_scroll`、`browser_extract`、`browser_evaluate`、`browser_find`、`browser_wait_for`、`browser_network`、`browser_select_option`、`browser_dialog`、`browser_download`、`browser_upload`、`browser_cookies`、`browser_pdf`、`browser_help`、`browser_close`
- 钩子：`session_start`、`session_shutdown`（启停浏览器进程）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册 18 个工具 |
| `logic.ts` | 纯逻辑 barrel |
| `config.ts` | 配置解析（settings.json 段 + 环境变量合并） |
| `impl.ts` | 浏览器实现：启动/动作/产物目录/敏感路径防护 |
| `types.ts` | 类型定义 |

## 配置（环境变量 > settings.json 段）

`PI_BROWSER_PROXY` / `PI_WEB_TOOLKIT_PROXY`、`PI_BROWSER_VIEWPORT_WIDTH`、`PI_BROWSER_VIEWPORT_HEIGHT`、`CLOAKBROWSER_BINARY_PATH`。settings.json 段：`pi-browser`（兼容旧 `pi-web-toolkit`）。

## 约定

- 截图/PDF/下载产物落在 `os.tmpdir()` 下的独立目录（非 `portable/`）。
- 上传路径有敏感路径校验（`isSensitiveUploadPath`）。
- Termux 下需 `scripts/patch-playwright-core.mjs` 扩展平台分支，浏览器才可用。

### `page.evaluate` 回调内**禁止**写具名函数（2026-10-07，踩过一次）

```ts
// ✗ 会抛 ReferenceError: __name is not defined
page.evaluate((sel: string) => {
  const walk = (root: Document) => { /* ... */ };   // ← 具名函数赋值
  walk(document);
});

// ✓ 用迭代/内联；只有**匿名**箭头作为参数传递才安全（如 .map((x) => ...)）
page.evaluate((sel: string) => {
  const stack: Document[] = [document];
  while (stack.length) { /* ... */ }
});
```

**根因**：tsx/esbuild 的 `keepNames` 会向**具名函数**注入 `__name(f, "f")` 调用，而 Playwright 把回调
**原样序列化**送到浏览器执行——浏览器里没有 `__name`。匿名函数（没有名字可保）不会被注入，所以
`.map((x) => ...)` 这类**作为参数传递**的箭头是安全的，只有"赋值给标识符"或 `function 名字(){}`
才会中招。这个坑的隐蔽之处在于**本地测试不会红**（本目录的测试刻意不启动浏览器），只有真跑浏览器才炸。

**守门**：`__tests__/evaluate-no-named-functions.test.ts` 用 TypeScript AST 扫本目录源码，
发现 `page.evaluate` 回调内的具名函数即失败。

### `browser_evaluate` 的字符串语义

Playwright 对**字符串**走「表达式求值」（`isFunction=false`）：传 `() => document.title` 求值出的是
**函数对象**，序列化后变 `undefined`（静默失败）。故 `BrowserManager.evaluate` 先用
`looksLikeFunctionExpression` 判定并包成 `(<expr>)()` 调用，失败再退回原始表达式（覆盖 `let t=1; t`
这类语句体）。**已知取舍**：失败退回会吞掉用户函数内部的真实报错（返回 `undefined` 而非抛错）。
