# knowledge-fetch — 零 LLM 知识订阅搭建

以官方 API + RSS 直连替代搜索引擎，为 pi 定时任务提供稳定、真实的信息抓取。

- **入口**：`SKILL.md`（诊断/渠道调研/抓取实现/调度接入/迭代五步流程）
- **已验证实例**：`scripts/knowledge-fetch.py` v2（抓取，5 大 section）+ `scripts/knowledge-ingest.mjs`（零 LLM 入库，内置去重）；接入 my-pi 定时任务 `knowledge-subscribe` / `daily-review`
- **环境备注**：termux-ubuntu（proot-Distro aarch64）；脚本随 my-pi 仓库分发，定时接入改 `portable/agent/scheduled-seeds.json`（已存在任务需 `node scripts/reseed-seeds.mjs --apply`）
- **维护**：使用后偏差按仓库级 `docs/development/SKILLS-MAINTENANCE.md` 机制沉淀，经验追加 `EXPERIENCE.md`
