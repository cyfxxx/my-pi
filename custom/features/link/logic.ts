/**
 * Link Feature — 纯逻辑出口（barrel，零 Pi 依赖）
 *
 * 大功能按职责分子包，`logic.ts` 仅作 barrel：
 *   - `types.ts`   共享类型
 *   - `config.ts`  设备配置读写与 ssh 目标校验
 *   - `net.ts`     局域网/WSL/Tailscale IP 探测
 *   - `card.ts`    设备卡片构建与校验
 *   - `guards.ts`  并发去重守卫
 *   - `state.ts`   状态文件（设备状态/活跃/信箱）与写锁
 *   - `display.ts` 结果格式化/设备清单/帮助文本
 * 传输层见 `protocol.ts`（SSH/RPC）。
 */

export * from './types';
export * from './config';
export * from './net';
export * from './card';
export * from './guards';
export * from './state';
export * from './display';
