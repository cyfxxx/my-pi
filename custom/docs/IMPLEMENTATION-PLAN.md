# my-pi 实施计划

## 总览

本文档记录 my-pi 项目的完整实施计划，包括各阶段的目标、任务、依赖关系和验收标准。

## Phase 1: 创建 adapters/ 适配器层

### 目标
隔离 pi API 变化，为扩展提供稳定的接口

### 任务清单

| 任务 | 文件 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 1.1 创建 adapters 目录结构 | `custom/src/adapters/` | P0 | 10 min |
| 1.2 实现 api.ts | `custom/src/adapters/api.ts` | P0 | 30 min |
| 1.3 实现 tools/tool-adapter.ts | `custom/src/adapters/tools/tool-adapter.ts` | P0 | 45 min |
| 1.4 实现 tools/interceptor.ts | `custom/src/adapters/tools/interceptor.ts` | P1 | 30 min |
| 1.5 实现 tools/layering.ts | `custom/src/adapters/tools/layering.ts` | P1 | 45 min |
| 1.6 实现 session/session-adapter.ts | `custom/src/adapters/session/session-adapter.ts` | P1 | 45 min |
| 1.7 实现 session/export-adapter.ts | `custom/src/adapters/session/export-adapter.ts` | P2 | 30 min |
| 1.8 创建 adapters/index.ts | `custom/src/adapters/index.ts` | P0 | 10 min |
| 1.9 编写 adapter 测试 | `custom/tests/integration/adapters/` | P1 | 60 min |

### 依赖关系
- 无前置依赖

### 状态: 已完成

### 验收标准
- [x] 所有 adapter 文件创建完成
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 文档编写完成

---

## Phase 2: 下沉工具系统纯函数

### 目标
将工具系统的纯函数逻辑从 packages/ 下沉到 custom/services/

### 任务清单

| 任务 | 文件 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 2.1 创建 services/tool-system 目录 | `custom/src/services/tool-system/` | P0 | 5 min |
| 2.2 下沉 truncation.ts | `custom/src/services/tool-system/truncation.ts` | P0 | 20 min |
| 2.3 下沉 path-utils.ts | `custom/src/services/tool-system/path-utils.ts` | P0 | 20 min |
| 2.4 下沉 render-utils.ts | `custom/src/services/tool-system/render-utils.ts` | P0 | 20 min |
| 2.5 下沉 edit-diff.ts | `custom/src/services/tool-system/edit-diff.ts` | P0 | 20 min |
| 2.6 下沉 output-accumulator.ts | `custom/src/services/tool-system/output-accumulator.ts` | P0 | 20 min |
| 2.7 下沉 file-mutation-queue.ts | `custom/src/services/tool-system/file-mutation-queue.ts` | P0 | 20 min |
| 2.8 下沉 tool-layering.ts | `custom/src/services/tool-system/tool-layering.ts` | P1 | 30 min |
| 2.9 创建 services/tool-system/index.ts | `custom/src/services/tool-system/index.ts` | P0 | 10 min |
| 2.10 更新原始位置的兼容导入 | `packages/coding-agent/src/core/tools/*.ts` | P0 | 30 min |
| 2.11 更新扩展导入路径 | `.pi/extensions/*/` | P0 | 60 min |
| 2.12 编写服务测试 | `custom/tests/unit/tool-system/` | P1 | 60 min |

### 依赖关系
- Phase 1 完成

### 状态: 已完成

### 验收标准
- [x] 所有工具系统服务下沉完成
- [ ] 原始位置的兼容导入正常工作
- [x] 扩展导入路径更新完成
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 文档编写完成

---

## Phase 3: 下沉会话管理纯函数

### 目标
将会话管理的纯计算逻辑下沉到 custom/services/

### 任务清单

| 任务 | 文件 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 3.1 创建 services/session 目录 | `custom/src/services/session/` | P0 | 5 min |
| 3.2 下沉 session-stats.ts | `custom/src/services/session/session-stats.ts` | P0 | 30 min |
| 3.3 下沉 context-usage.ts | `custom/src/services/session/context-usage.ts` | P0 | 30 min |
| 3.4 下沉 session-export.ts | `custom/src/services/session/session-export.ts` | P0 | 30 min |
| 3.5 下沉 session-discovery.ts | `custom/src/services/session/session-discovery.ts` | P0 | 30 min |
| 3.6 创建 session-log-bridge.ts | `custom/src/services/session/session-log-bridge.ts` | P1 | 45 min |
| 3.7 创建 services/session/index.ts | `custom/src/services/session/index.ts` | P0 | 10 min |
| 3.8 更新原始位置的兼容导入 | `packages/coding-agent/src/core/*.ts` | P0 | 30 min |
| 3.9 更新扩展导入路径 | `.pi/extensions/*/` | P0 | 30 min |
| 3.10 编写服务测试 | `custom/tests/unit/session/` | P1 | 60 min |

### 依赖关系
- Phase 1 完成

### 状态: 已完成

### 验收标准
- [x] 所有会话管理服务下沉完成
- [ ] session-log 桥接正常工作
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 文档编写完成

---

## Phase 4: 增强 seams/ 工具消费者

### 目标
让 seams 层的工具消费者成为完整的工具注册入口

### 任务清单

| 任务 | 文件 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 4.1 增强 shell/tool-consumer.ts | `custom/seams/shell/tool-consumer.ts` | P1 | 45 min |
| 4.2 增强 fs/tool-consumer.ts | `custom/seams/fs/tool-consumer.ts` | P1 | 45 min |
| 4.3 增强 search/tool-consumer.ts | `custom/seams/search/tool-consumer.ts` | P1 | 45 min |
| 4.4 创建 seams/tool-system/ | `custom/seams/tool-system/` | P2 | 30 min |
| 4.5 更新 integration.ts | `custom/integration.ts` | P1 | 30 min |
| 4.6 编写 seams 测试 | `custom/tests/integration/seams/` | P2 | 60 min |

### 依赖关系
- Phase 1, Phase 2 完成

### 状态: 部分完成

### 验收标准
- [x] seams 工具消费者增强完成
- [ ] 工具注册流程正常工作
- [ ] TypeScript 编译通过
- [ ] 集成测试通过
- [ ] 文档编写完成

---

## Phase 5: 建立补丁管理机制

### 目标
当必须修改 packages/ 时，用补丁管理

### 任务清单

| 任务 | 文件 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 5.1 创建 patches 目录 | `patches/` | P2 | 5 min |
| 5.2 编写 patches/README.md | `patches/README.md` | P2 | 20 min |
| 5.3 编写 sync-upstream.sh | `scripts/tools/sync-upstream.sh` | P2 | 30 min |
| 5.4 测试同步流程 | 手动测试 | P2 | 30 min |
| 5.5 编写同步文档 | `custom/docs/UPSTREAM-SYNC.md` | P2 | 30 min |

### 依赖关系
- Phase 1, Phase 2, Phase 3 完成

### 验收标准
- [ ] 补丁管理机制建立完成
- [ ] 同步脚本测试通过
- [ ] 文档编写完成

---

## 进度跟踪

### 当前阶段
- **Phase**: 5
- **状态**: 进行中
- **开始时间**: 2026-09-15
- **预计完成**: 2026-09-20

### 完成记录

| 日期 | 阶段 | 任务 | 状态 |
|------|------|------|------|
| 2026-09-15 | Phase 1 | 1.1-1.9 创建 adapters 适配器层 | 已完成 |
| 2026-09-15 | Phase 2 | 2.1-2.12 下沉工具系统纯函数 | 已完成 |
| 2026-09-15 | Phase 3 | 3.1-3.10 下沉会话管理纯函数 | 已完成 |
| 2026-09-15 | Phase 4 | 4.1-4.3 增强 seams 工具消费者 | 已完成 |
| 2026-09-15 | Phase 5 | 5.1 创建 patches 目录 + README.md | 进行中 |

### 待办事项

- [x] Phase 1: 创建 adapters/ 适配器层
- [x] Phase 2: 下沉工具系统纯函数
- [x] Phase 3: 下沉会话管理纯函数
- [ ] Phase 4: 增强 seams/ 工具消费者
- [ ] Phase 5: 建立补丁管理机制

---

## 风险管理

### 潜在风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| pi API 大幅变更 | 高 | 适配器层隔离 + 补丁管理 |
| 下沉服务依赖复杂 | 中 | 渐进式下沉 + 兼容导入 |
| 上游同步冲突 | 中 | 补丁重放 + 手动解决 |
| 测试覆盖不足 | 中 | 逐步完善测试 |

### 回滚方案

如果某个阶段出现问题，可以：
1. 回滚到上一个稳定版本
2. 重新评估方案
3. 调整实施计划
