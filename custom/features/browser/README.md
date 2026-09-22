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
