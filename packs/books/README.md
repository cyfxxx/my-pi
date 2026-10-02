# packs/books — 书籍知识库（技能包）

外部技能包：**不注入系统提示词**，需要时由 Agent 读取 `SKILL.md` 并调用 `scripts/books.py`。
之所以放 `packs/` 而不是 `portable/agent/skills/`：那条路会把技能名/描述注入 system 前缀（实测约 450 B/个），
而这套能力是低频、按需的——放这里零前缀成本（见 `docs/development/TOOL-EXTERNALIZATION-ANALYSIS.md`）。

- `SKILL.md`：使用说明（三步流程 / 预算 / 引用格式 / 质量门 / 两端分工）。
- `config.example.json`：配置模板；实际配置写 `portable/memory/books/config.json`（运行时，不入库）。

方案与实测依据：`docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md`。
