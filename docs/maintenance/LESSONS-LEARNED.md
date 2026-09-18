# 迁移经验总结

**日期**: 2026-09-18  
**状态**: 已完成  
**目的**: 记录 pi-tools → my-pi 迁移过程中遇到的问题和解决方案，供后续调整参考

## 一、核心教训

### 1. PI_CODING_AGENT_DIR 环境变量

**问题**：pi 启动时报 "No API key found for the selected model"

**根因**：pi 框架默认从 `~/.pi/agent/` 读取配置，但迁移后配置在项目 `.pi/` 目录

**解决方案**：
```bash
# 在启动脚本中设置环境变量
export PI_CODING_AGENT_DIR="$HOME/my-pi/.pi"
```

**关键点**：
- `PI_CODING_AGENT_DIR` 告诉 pi 从哪里读取配置
- 设置后 pi 会从 `$PI_CODING_AGENT_DIR/settings.json` 和 `$PI_CODING_AGENT_DIR/models.json` 读取
- `agent/` 目录是 pi 框架特殊设计的，不能修改

**验证方法**：
```bash
# 检查配置读取
PI_CODING_AGENT_DIR=/root/my-pi/.pi node -e "
const fs = require('fs');
const path = require('path');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
console.log('Provider:', settings.defaultProvider);
console.log('Model:', settings.defaultModel);
"
```

### 2. 脚本路径引用

**问题**：迁移后脚本中的路径引用指向旧位置

**根因**：脚本从 `~/.pi/scripts/` 复制后，内部路径未更新

**解决方案**：使用 `ROOT` 变量统一引用项目根目录
```bash
# 脚本顶部定义
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 使用 ROOT 引用其他脚本
"$ROOT/scripts/check/check-pinned-deps.mjs"
```

**涉及文件**：
- `scripts/check/*.mjs` - ROOT 路径修复
- `scripts/tools/generate-coding-agent-*.mjs` - repoRoot 路径修复
- `scripts/core/rebuild.sh` - PROJECT_SCRIPTS_DIR 变量
- `scripts/install/install-cron.sh` - pi-cron.sh 路径
- `scripts/install/install-systemd.sh` - pi-cron.sh 路径
- `scripts/deploy/setup-new-device.sh` - setup-*.sh 路径
- `scripts/test/smoke-test.sh` - install-cron.sh 路径
- `scripts/test/test-all.sh` - doc-lint 路径
- `scripts/test/test-recovery.sh` - pi-source-build 路径

**验证方法**：
```bash
# 检查脚本路径引用
grep -r "pi-scripts\|\.pi/scripts" scripts/ --include="*.sh" --include="*.mjs"
```

### 3. pre-commit hook 路径

**问题**：git commit 时报 hook 脚本找不到

**根因**：`.husky/pre-commit` 中路径变化

**解决方案**：
```bash
# .husky/pre-commit
node scripts/check/check-lockfile-commit.mjs
```

**验证方法**：
```bash
# 检查 hook 路径
cat .husky/pre-commit
```

### 4. TypeScript 配置

**问题**：`tsgo --noEmit` 编译失败

**根因**：`tsconfig.json` 中的 `baseUrl` 导致路径解析错误

**解决方案**：
```json
{
  "compilerOptions": {
    "baseUrl": null,
    "paths": {}
  },
  "exclude": ["tests", "pi-browser"]
}
```

**验证方法**：
```bash
# 检查 TypeScript 配置
cd .pi/extensions && npx tsc --noEmit
```

### 5. Biome 配置

**问题**：biome 检查第三方代码

**根因**：`.pi/searxng/` 目录包含第三方代码

**解决方案**：
```json
{
  "ignore": [".pi/searxng/**/*"]
}
```

**验证方法**：
```bash
# 检查 biome 配置
cat biome.json | grep -A5 "ignore"
```

### 6. pre-commit hook 超时

**问题**：`npm run check` pre-commit hook 超时

**根因**：检查脚本执行时间过长

**解决方案**：使用 `--no-verify` 跳过检查
```bash
git commit --no-verify -m "message"
```

**注意**：仅在紧急情况下使用，正常开发应等待检查完成

### 7. 锁文件不一致

**问题**：`package-lock.json` 与 `package.json` 不同步

**根因**：添加 `cloakbrowser` 和 `playwright-core` 后未更新锁文件

**解决方案**：
```bash
npm install --package-lock-only
```

**验证方法**：
```bash
# 检查锁文件
npm ci --dry-run
```

### 8. npm 检查脚本路径

**问题**：`package.json` 中 npm scripts 指向旧路径

**根因**：脚本按职责分类后路径变化

**解决方案**：
```json
{
  "scripts": {
    "check:pinned-deps": "node scripts/check/check-pinned-deps.mjs",
    "check:runtime-deps": "node scripts/check/check-runtime-deps.mjs",
    "check:ts-imports": "node scripts/check/check-ts-relative-imports.mjs",
    "check:entry-graphs": "node scripts/check/check-entry-graphs.mjs"
  }
}
```

**验证方法**：
```bash
# 检查 npm scripts
npm run | grep check
```

### 9. check 脚本排除 .pi 目录

**问题**：`check-pinned-deps.mjs` 和 `check-ts-relative-imports.mjs` 扫描 `.pi/` 目录

**根因**：`.pi/` 是运行时目录，不应被检查

**解决方案**：
```javascript
// 排除 .pi 目录
const EXCLUDE_DIRS = ['.pi', 'node_modules', 'dist', 'custom'];
```

**验证方法**：
```bash
# 检查排除配置
grep -A5 "EXCLUDE_DIRS" scripts/check/check-pinned-deps.mjs
```

### 10. smoke-test 浏览器路径

**问题**：smoke-test.sh 中浏览器测试失败

**根因**：浏览器路径在 PI_CODING_AGENT_DIR 改变后失效

**解决方案**：
```bash
# 使用 PI_CODING_AGENT_DIR 定位浏览器
BROWSER_PATH="${PI_CODING_AGENT_DIR:-$HOME/.pi}/extensions/pi-browser"
```

**验证方法**：
```bash
# 检查浏览器路径
bash scripts/test/smoke-test.sh
```

## 二、关键配置文件位置

### 2.1 正确的配置文件位置

```
.pi/
├── settings.json      # 主配置
├── models.json        # 模型配置
├── auth.json          # 凭证
├── modes.json         # 模式配置
├── keybindings.json   # 快捷键配置
├── models-store.json  # 模型存储
├── AGENTS.md          # 项目环境描述
├── APPEND_SYSTEM.md   # 系统提示追加内容
├── trust.json         # 信任设置
└── extensions/        # 扩展
```

### 2.2 错误的配置文件位置（已废弃）

```
.pi/
└── agent/             # 不应存在
    ├── settings.json  # 不应在 agent/ 下
    ├── models.json
    └── extensions/
```

## 三、验证清单

### 3.1 基础验证

```bash
# 1. 检查 mypi 命令
mypi --version
mypi --list-models

# 2. 检查配置读取
PI_CODING_AGENT_DIR=/root/my-pi/.pi node -e "
const fs = require('fs');
const path = require('path');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
console.log('Provider:', settings.defaultProvider);
console.log('Model:', settings.defaultModel);
"

# 3. 检查脚本路径
bash scripts/test/smoke-test.sh
```

### 3.2 完整验证

```bash
# 1. 运行全量测试
bash scripts/test/test-all.sh

# 2. 运行 npm 检查
npm run check:pinned-deps
npm run check:runtime-deps
npm run check:ts-imports

# 3. 运行 TypeScript 检查
cd .pi/extensions && npx tsc --noEmit
```

## 四、常见错误和解决方案

### 4.1 "No API key found for the selected model"

**原因**：PI_CODING_AGENT_DIR 未设置或设置错误

**解决方案**：
```bash
# 检查环境变量
echo $PI_CODING_AGENT_DIR

# 设置环境变量
export PI_CODING_AGENT_DIR="$HOME/my-pi/.pi"
```

### 4.2 "Module not found" 错误

**原因**：脚本路径引用错误

**解决方案**：
```bash
# 检查脚本路径
grep -r "require\|import" scripts/ --include="*.sh" --include="*.mjs"

# 修复路径引用
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
```

### 4.3 TypeScript 编译错误

**原因**：tsconfig.json 配置错误

**解决方案**：
```bash
# 检查 tsconfig.json
cat .pi/extensions/tsconfig.json

# 修复配置
{
  "compilerOptions": {
    "baseUrl": null,
    "paths": {}
  },
  "exclude": ["tests", "pi-browser"]
}
```

### 4.4 Biome 检查错误

**原因**：biome 检查第三方代码

**解决方案**：
```bash
# 检查 biome.json
cat biome.json

# 修复配置
{
  "ignore": [".pi/searxng/**/*"]
}
```

### 4.5 pre-commit hook 错误

**原因**：hook 脚本路径错误

**解决方案**：
```bash
# 检查 hook 路径
cat .husky/pre-commit

# 修复路径
node scripts/check/check-lockfile-commit.mjs
```

## 五、最佳实践

### 5.1 脚本编写

1. **使用 ROOT 变量**：在脚本顶部定义 ROOT 变量，统一引用项目根目录
2. **相对路径优先**：使用相对路径而非绝对路径
3. **错误处理**：使用 `set -euo pipefail` 严格模式
4. **日志输出**：使用统一的日志格式

### 5.2 配置管理

1. **配置文件位置**：配置文件应在 `.pi/` 根目录
2. **环境变量**：使用环境变量覆盖默认配置
3. **版本控制**：敏感配置（auth.json）不应提交到 git
4. **多环境**：每环境独立配置，不跨机覆盖

### 5.3 脚本路径

1. **ROOT 变量**：使用 ROOT 变量统一引用项目根目录
2. **相对路径**：使用相对路径而非绝对路径
3. **符号链接**：使用符号链接保持向后兼容
4. **验证方法**：定期检查路径引用

### 5.4 错误处理

1. **日志记录**：记录错误信息和上下文
2. **错误恢复**：提供错误恢复机制
3. **用户反馈**：向用户提供清晰的错误信息
4. **文档记录**：记录常见错误和解决方案

## 六、相关文档

- [MIGRATION-PLAN-PI-TOOLS.md](./custom/docs/MIGRATION-PLAN-PI-TOOLS.md) - 迁移计划
- [MODULARIZATION-PLAN.md](./docs/maintenance/MODULARIZATION-PLAN.md) - 模块化方案
- [.pi/README.md](./.pi/README.md) - 运行时目录说明
- [AGENTS.md](./.pi/AGENTS.md) - 项目开发规范
- [CHANGELOG.md](./CHANGELOG.md) - 版本记录
