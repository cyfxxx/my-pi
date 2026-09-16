# searxng/ — SearXNG 自托管搜索

SearXNG 自托管搜索引擎配置，为 pi-web-search 扩展提供私密搜索能力。

## 文件

| 文件 | 用途 |
|------|------|
| settings.yml | SearXNG 配置（端口 8889，中文 locale，百度/必应/搜狗引擎） |
| generate-config.sh | 配置生成脚本 |
| start.sh | 启动脚本 |
| stop.sh | 停止脚本 |

## 配置要点

- **端口**: 8889
- **搜索引擎**: 百度、必应、搜狗（国内可用）
- **禁用引擎**: Google、DuckDuckGo（GFW 限制）
- **超时**: 30 秒

## 相关文档

- [pi-web-search 扩展](../.pi/extensions/pi-web-search/README.md)
- [settings.json 配置](../.pi/settings.json)
