# packs 技能索引

> ## 如何使用
>
> 1. 若用户需求不被内置 6 个技能（`pi-backup`/`pi-bug-diagnosis`/`pi-download-safety`/`pi-full-audit`/`pi-net-mirror`/`pi-translate-zh`）覆盖，先查本索引找到匹配技能。
> 2. 命中后对应读取 `packs/<name>/SKILL.md` 了解完整步骤。
>
> ## 包索引
>
> | 技能 | 触发词 | 用途 |
> |------|--------|------|
> | `books` | 查书、书里怎么说、出自哪本书哪一页、核对原文、书库索引 | 书籍知识库（探针/索引/按需提页/缓存复用） |
> | `cangjie-skill` | 拆书、蒸馏、做 skill、书籍蒸馏、内容提取、知识沉淀 | 把书籍/视频/播客蒸馏为可执行技能 |
> | `colab-bridge` | Colab、远程 GPU、远程 Python 执行 | Google Colab 作为远程 Python/GPU 后端 |
> | `comfyui-agent` | 出图、生图、ComfyUI、文生图、图生图、跑工作流、AI 绘画 | 远程 ComfyUI 图像生成 |
> | `dg-piagent` | 创建 agent、自定义工具、编写扩展、修改系统提示词、管理会话、配置模型 | pi-agent SDK 开发指南 |
> | `embedded-dev` | 嵌入式、MCU、固件、硬件调试 | 嵌入式开发辅助（构建/烧录/调试） |
> | `gamedev` | 游戏开发、游戏制作、Phaser、Godot | 游戏开发工具链 |
> | `knowledge-fetch` | 新闻、订阅、信息渠道、知识订阅、抓取信息、RSS 抓取 | 知识订阅系统搭建 |
> | `media-toolkit` | 图片、视频、美术、图片处理、视频剪辑、游戏美术 | 图片/视频/游戏美术处理 |
> | `novel-writing` | 写小说、网文、长篇写作、小说大纲 | 长篇小说工程化写作 |
> | `pcb-design` | PCB、原理图、硬件、电路板审查、KiCad | PCB/硬件设计辅助 |
> | `pdf-toolkit` | PDF、pdf、文档提取、合并、加密 | PDF 全场景处理 |
> | `reverse-skill` | 逆向、渗透、安全研究、CTF、漏洞利用 | 逆向/授权渗透/安全研究技能路由（包内 frontmatter `name: reverse-skill-router`；入口 `skills/SKILL.md`） |
> | `termux` | ZeroTermux、Termux、平板开发、proot 容器、proot-distro、换源、pkg、保活、定时任务、X11、ZtInfo、zt 命令 | Android 平板/手机上的 ZeroTermux/Termux 开发辅助：宿主↔proot 容器互通、包管理与换源、保活与定时任务、平板交互与互传、容器实测坑（入口 `SKILL.md`） |
> | `skill-integration` | 技能包、整合、外部技能、GitHub 技能包 | 外部技能包整合流程 |
>
> ## 二级功能索引
>
> | 技能 | 子技能 / 入口 | 用途 |
> |------|---------|------|
> | `media-toolkit` | `skills/image-basics`：通用图片处理（缩放/裁剪/转换/压缩/水印/批量/PDF→图）→ `skills/video-basics`：通用视频处理（转码/剪辑/拼接/抽帧/音频/GIF/字幕） | 图片/视频/游戏美术处理 |
> | `pi-net-mirror` | `packs/net-mirror/MEASUREMENTS.md`：加速实测表 + 命令模板 + 便携化 | 网络受限时的加速选路（用前先 `node scripts/net-mirror.mjs --probe` 断言字节数、`node scripts/net-proxy.mjs` 优先走宿主代理） |
> | `pi-download-safety` | `packs/security-baseline/`：`tiers.json` 分层清单 + `BASELINE.md` + `yara/starter.yar` | 下载安全与分层防篡改基线（`node scripts/security-baseline.mjs --tier1 --verify`） |
> | `pdf-toolkit` | `pdf_core`：提取文本/表格/图片/元数据；合并/拆分/旋转/加密/解密；加水印；`skills/pdf-forms`：PDF 表单填写；`skills/pdf-ocr`：扫描件 OCR | PDF 全场景处理 |
>
> _注：二级索引列出核心子技能路径，完整列表请读对应 `SKILL.md` 文件。_
