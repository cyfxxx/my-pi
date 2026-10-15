/**
 * shim 的"只报一次"通道。
 *
 * 为什么 shim 必须**上报**而不是安静地当空实现：DSH 上没有 pi 的 TUI，
 * 任何依赖 TUI 渲染/会话枚举的功能都会**降级**；静默降级 = 行为悄悄变了（本项目最怕的失效形态）。
 */
const warned = new Set();

/** 上报一次（同一 key 只打印一次，避免刷屏） */
export function reportShim(key, detail) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[dsh-pi-shim] ${key}：${detail}`);
}

/** 供测试重置（生产代码不应调用） */
export function resetShimReports() {
  warned.clear();
}
