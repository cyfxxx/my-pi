---
name: pi-translate-zh
description: vendor/pi 重新构建后重新翻译 TUI 中文界面：命令描述、设置菜单、子菜单、提示词描述、扩展命令、技能描述。用户说"翻译""中文化""汉化""翻译失效"时触发。不适用：上游同步前无需预防性执行；仅翻译单个文件时先确认 patch-all-zh.mjs 已覆盖。
version: v1.1
更新日期: 2026-09-20
---

# 补丁：pi TUI 完整中文化

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.1 |
| 更新日期 | 2026-09-20 |
| 适用场景 | my-pi 重新构建 vendor/pi 后中文翻译失效、首次构建后中文化 |
| 不适用 | 上游同步前无需预防性执行；仅翻译单个文件时先确认 patch-all-zh.mjs 已覆盖 |
| 依赖 | patch-all-zh.mjs 脚本 |
| 目标目录 | `<root>/vendor/pi/packages/coding-agent/dist/` |

---

## 目录

- [一、概述](#一概述)
- [二、工作流](#二工作流)
- [三、详细步骤](#三详细步骤)
- [四、覆盖范围](#四覆盖范围)
- [五、使用示例](#五使用示例)
- [六、常见问题](#六常见问题)
- [七、更新记录](#七更新记录)

---

## 一、概述

### 1.1 解决的问题

my-pi 的 `vendor/pi/` 是上游 pi 的独立 clone，`dist/` 为构建产物。每次同步上游并重新构建后，中文翻译随 `dist/` 一起被覆盖，需要重新应用。

上游同步的等价操作（my-pi 中不存在 `pi update` 命令）：

```bash
# 1. 同步上游源码（可选：指定 commit）
bash scripts/sync-upstream.sh

# 2. 重新构建 vendor/pi(coding-agent) 与 custom/
bash scripts/build.sh
```

`bash scripts/build.sh` 会用新构建的 `dist/` 覆盖旧产物，因此**每次构建后都要重跑补丁脚本**。

### 1.2 设计理念

- **增量安全**：脚本自动跳过已翻译的字符串
- **代码标识符不翻译**：'user'/'project' 等枚举值、`${m.provider}/${m.id}` 等拼接模板保持英文
- **缺失即跳过**：`vendor/pi` 之外的扩展在 my-pi 中不存在，对应区段安全跳过，不报错

---

## 二、工作流

```
同步上游/重新构建 vendor → 运行补丁脚本 → 重启 pi → 验证翻译
```

---

## 三、详细步骤

### 3.1 重新翻译

```bash
node <root>/portable/agent/skills/pi-translate-zh/patch-all-zh.mjs
```

脚本自行解析 pi 核心包路径，优先级：

1. `<root>/vendor/pi/packages/coding-agent`（my-pi 仓库内 vendored 上游，最高优先级）
2. npm global 常见路径（`/usr/lib`、`/usr/local/lib`）
3. `npm root -g`
4. `require.resolve("@earendil-works/pi-coding-agent")` 与入口文件推算
5. `$HOME/node_modules` 兜底搜索

重启 pi 后生效。

### 3.2 重新构建后查找需要翻译的新文件

上游同步后可能新增或修改界面文字。以下排查步骤定位需要补充翻译的位置。

先设置路径变量：

```bash
# 仓库根（按实际路径调整）
ROOT=/root/my-pi
PI="$ROOT/vendor/pi/packages/coding-agent"
```

#### 1. 查找未翻译的 description/label

```bash
# pi 核心命令
grep -rn 'description:\s*"[A-Z]\|label:\s*"[A-Z]' "$PI/dist/" --include='*.js' | grep -v node_modules

# my-pi 自定义功能（扩展命令注册）
grep -rn 'description:\s*"[A-Z]\|label:\s*"[A-Z]' "$ROOT/custom/features"/*/index.ts 2>/dev/null
```

#### 2. 查找未翻译的 SKILL.md 描述

```bash
# my-pi 技能
find "$ROOT/portable/agent/skills" -name SKILL.md -exec grep -l '^description:' {} \;

# 自定义功能内附带的技能
find "$ROOT/custom/features" -name SKILL.md -exec sh -c 'grep -q "^description:" "$1" && ! grep -qP "[\x{4e00}-\x{9fff}]" "$1" && echo "⚠️  $1"' _ {} \;
```

#### 3. 查找 pi 交互界面中未翻译的用户可见字符串

```bash
# 设置菜单选择器
grep -n 'label:\s*"[A-Z]\|description:\s*"[A-Z]' "$PI/dist/modes/interactive/components/settings-selector.js"

# 会话选择器排序/筛选
sed -n '105,120p' "$PI/dist/modes/interactive/components/session-selector.js"

# 交互模式区段标题
sed -n '1050,1100p' "$PI/dist/modes/interactive/interactive-mode.js" | grep 'addLoadedSection'
```

#### 4. 查找扩展命令注册

```bash
PI="$ROOT/vendor/pi/packages/coding-agent"
grep -n 'registerCommand' "$PI/dist/core/slash-commands.js"
grep -rn 'commands: \|registerCommand\|name: "/' "$ROOT/custom/features"/*/index.ts | head -50
```

### 3.3 查找原则

- `description: "..."`（双引号字符串）→ 替换为 `description: \`...\``（模板字面量）
- `description: \`...\``（模板字面量）中的英文→ 替换为中文
- `children:"..."`（HTML JSX 属性）→ 替换为 `children:"中文"`
- SKILL.md `description:` 块→ 保留 YAML 格式，替换文本内容
- 增量安全：脚本自动跳过已翻译的字符串
- 模板字面量字符串需子串匹配
- 代码标识符不翻译

### 3.4 可选扩展缺失（正常现象）

my-pi 中不存在 `portable/agent/npm/node_modules`，以下 npm 扩展在 my-pi 中缺失，属正常情况：

- `@plannotator/pi-extension`（含 `plannotator.html` / `review-editor.html` UI）
- `pi-lens`
- `pi-markdown-preview`
- `pi-subagents` / `@juicesharp/rpiv-todo` / `context-mode`（脚本中同样通过 `existsSync` 判定）

脚本对每一节先做 `existsSync` 检查，缺失时输出「跳过：不存在」，并在结尾汇总跳过节数；命中的原文未匹配时通过 `missingAll` 机制在结尾警告。这两类输出都不代表脚本出错。

`plan-mode` 已内置于 `custom/features/plan-mode/`，对应区段检查 `<root>/portable/agent/extensions/plan-mode/index.ts`（该路径在 my-pi 中不存在，同样安全跳过）。

---

## 四、覆盖范围

| 类别 | 来源 | 数量 |
|------|------|------|
| 内置命令描述 | `vendor/pi/packages/coding-agent/dist/core/slash-commands.js` | 22 条 |
| 设置菜单：标签/描述/子菜单/思考深度 | `.../dist/modes/interactive/components/settings-selector.js` | ~59 项 |
| 思考深度选择器 | `.../dist/modes/interactive/components/thinking-selector.js` | 7 项 |
| 状态指示器 | `.../dist/modes/interactive/components/status-indicator.js` | 2 项 |
| 交互模式：状态/错误/提示消息 | `.../dist/modes/interactive/interactive-mode.js` | ~65 条 |
| 资源配置：扩展/提示词/设置页标签 | `.../dist/modes/interactive/components/config-selector.js` | 8 项 |
| 登录对话框 | `.../dist/modes/interactive/components/login-dialog.js` | 3 项 |
| 会话选择器 | `.../dist/modes/interactive/components/session-selector.js` | 8 项 |
| 树导航 | `.../dist/modes/interactive/components/tree-selector.js` | 2 项 |
| 模型选择器 | `.../dist/modes/interactive/components/model-selector.js` | 2 项 |
| OAuth 提供商选择器 | `.../dist/modes/interactive/components/oauth-selector.js` | 5 项 |
| CLI 主入口：提示/警告/错误 | `.../dist/main.js` | 9 项 |
| 启动页脚 | `.../dist/modes/interactive/components/daxnuts.js` | 2 项 |
| agent-session 核心消息 | `.../dist/core/agent-session.js` | 1 项 |
| provider-composer 登录提示 | `.../dist/core/provider-composer.js` | 1 项 |
| model-resolver 消息 | `.../dist/core/model-resolver.js` | 1 项 |
| 用户 skill 描述（如存在） | `portable/agent/skills/*/SKILL.md` | 按需 |
| plannotator / pi-lens / pi-markdown-preview | npm 扩展（my-pi 中缺失） | 0（跳过） |

前 16 行的路径均以 `<root>/vendor/pi/packages/coding-agent/` 为前缀。

---

## 五、使用示例

### 5.1 触发场景

用户说：
- "翻译"
- "中文化"
- "汉化"
- "翻译失效"

### 5.2 执行流程

```bash
# 0. 若刚同步上游，先重新构建
# bash scripts/sync-upstream.sh && bash scripts/build.sh

# 1. 运行补丁脚本
node <root>/portable/agent/skills/pi-translate-zh/patch-all-zh.mjs

# 2. 重启 pi
# 退出当前会话，重新启动 pi

# 3. 验证翻译
# 输入 `/`、`/settings`，并检查扩展命令的 help 输出与提示词是否显示中文
```

### 5.3 干跑校验（不写文件）

```bash
node <root>/portable/agent/skills/pi-translate-zh/patch-all-zh.mjs --check
```

输出各节可替换项与未匹配原文，用于判断补丁与当前上游版本的兼容度。若可替换项接近 0，说明上游结构已变更，需要更新补丁条目。

---

## 六、常见问题

- **Q1**: 重新构建后翻译失效怎么办？
  **A**: 运行 `node <root>/portable/agent/skills/pi-translate-zh/patch-all-zh.mjs`，重启 pi。

- **Q2**: 如何查找未翻译的字符串？
  **A**: 参考"重新构建后查找需要翻译的新文件"章节。

- **Q3**: 翻译后哪些地方需要验证？
  **A**: 输入 `/`、`/settings`，并检查扩展命令的 help 输出与提示词是否显示中文。

- **Q4**: 代码标识符需要翻译吗？
  **A**: 不需要，'user'/'project' 等枚举值、`${m.provider}/${m.id}` 等拼接模板保持英文。

- **Q5**: 脚本输出大量「跳过：不存在」和未匹配警告，是出错了吗？
  **A**: 不是。plannotator、pi-lens、pi-markdown-preview 等 npm 扩展在 my-pi 中不存在（见 3.4），`missingAll` 警告只表示上游该版本的原文已删除/移位，需要更新补丁条目。

- **Q6**: 如何还原翻译？
  **A**: 脚本每次修改前生成 `.bak.时间戳` 备份（每文件保留最近 3 份），从 `dist/` 对应目录的备份文件还原即可；重新构建 `dist/` 也会回到上游原文。

---

## 七、更新记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-20 | v1.1 | 迁移到 my-pi：路径改为 `vendor/pi/packages/coding-agent` 与 `portable/agent/skills/`；上游更新等价物改为 `scripts/sync-upstream.sh` + `scripts/build.sh`；移除 my-pi 不存在的 npm 扩展区段，注明缺失属正常 |
| 2026-09-12 | v1.1 | 按照文档模板重新组织结构，添加元信息、目录导航、章节编号 |
| 2026-08-XX | v1.0 | 初始版本，实现 pi TUI 完整中文化 |

---

## 八、使用后改进（必做）

任务收尾时清点：执行过程与本文步骤/路径/结论的偏差。有 → 追加一条到 `improvements.md`（证据导向：命令、路径、现象，不直接改正文）。未合并条目 ≥3 条或用户要求时，合并进正文并清日志。机制全文见 `docs/development/SKILLS-MAINTENANCE.md`。
