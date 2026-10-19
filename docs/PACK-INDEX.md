# 技能包索引（按需取用，不入库）

> 生成时间：2026-10-19；生成脚本：`assistant/scripts/gen-pack-index.mjs`。
> 共 18 个包、147 个技能、10 MB。

| 包 | 技能数 | 大小 | 说明 |
|---|---|---|---|
| `reverse-skill` | 89 | 8202 KB | Internal downstream skill for ctf-sandbox-orchestrator. CTF- |
| `gamedev` | 40 | 474 KB | > |
| `media-toolkit` | 4 | 33 KB | 图片/视频/游戏美术处理技能包。用户要处理图片（缩放/裁剪/压缩/格式/水印/批量）、视频（转码/剪辑/拼接/抽帧/音频 |
| `pdf-toolkit` | 3 | 46 KB | PDF 全场景处理入口：文本/表格/图片提取、合并拆分旋转加密、生成、水印、扫描件 OCR、表单填写。用户提到 .pdf |
| `books` | 1 | 8 KB | 书籍知识库（本机索引 + 按需提取页 + 缓存复用）。用户要求"查书里某段内容""这个说法出自哪本书哪一页""核对原文" |
| `cangjie-skill` | 1 | 64 KB | Distill a book, long-video transcript, podcast, course, or i |
| `colab-bridge` | 1 | 29 KB | 把 Google Colab（免费 GPU）作为 pi 的远程 Python/GPU 执行后端。用法：colab_exe |
| `comfyui-agent` | 1 | 75 KB | 让 pi 把远程 ComfyUI（其他有 GPU 的设备上运行的实例）当作图像生成工具使用。提供完整操控：连接配置（se |
| `dg-piagent` | 1 | 1110 KB | / |
| `embedded-dev` | 1 | 16 KB | 嵌入式/MCU 开发的 AI 辅助技能入口：构建、烧录、调试、串口、协议测试的领域地图与工具链路由，含上游技能集目录与专 |
| `knowledge-fetch` | 1 | 12 KB | 搭建零 LLM 官方源直连的知识订阅（渠道调研、抓取脚本、去重过滤容错、定时任务接入）。用户说"新闻功能没触发""加信息 |
| `novel-writing` | 1 | 44 KB | 长篇中文小说（网文）工程化写作系统。当用户要写/续写/规划/大纲/细纲/目录/草案/正文/审查/体检/存档长篇小说，或需 |
| `pcb-design` | 1 | 22 KB | PCB/硬件设计的 AI 辅助技能入口：KiCad 工具链路由、设计审查闭环契约、ERC/DRC/Gerber/EMC  |
| `skill-integration` | 1 | 4 KB | 外部技能包（GitHub zip 等）引入与整合进仓库内 packs/ 的统一流程：选包下载、安全审查、验收冒烟、通用/ |
| `termux` | 1 | 29 KB | 在 Android 平板/手机上的 ZeroTermux（Termux 0.118.3 的中文增强 fork）或官方 T |
| `drafts` | 0 | 0 KB |  |
| `net-mirror` | 0 | 3 KB |  |
| `security-baseline` | 0 | 20 KB |  |

## 用法

```bash
# 需要某个包时，从老仓库按路径取（或以后放到独立 skills 仓库）：
git -C /path/to/my-pi archive HEAD packs/<包名> | tar -x -C .
```
