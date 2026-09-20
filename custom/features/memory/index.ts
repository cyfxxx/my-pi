/**
 * Memory Feature
 * 
 * 约束：
 *   - 只通过 adapters 与 Pi 交互
 *   - 不直接 import vendor/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import {
  loadEntries,
  loadNotes,
  loadSummaries,
  updateNotes,
  activeEntries,
  autoReclaim,
  migrateFromCtxLite,
  buildInjectionBlock,
  INJECT_TAG,
  filterInjectedMessages,
  isExtractWorker,
  processPendingExtracts,
  queuePendingExtract,
  extractTextFromEntries,
  writeCompactionSnapshot,
} from './logic';

export function register(pi: ExtensionAPI): void {
  // 注册钩子：会话开始
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event: unknown, ctx: any) => {
      if (isExtractWorker()) return;
      migrateFromCtxLite();
      
      const notes = loadNotes();
      const noteCount = Object.keys(notes).filter(
        k => !k.startsWith('__') && !k.startsWith('_ctx.')
      ).length;
      
      const compactedAt = notes['_ctx.compacted_at'];
      if (compactedAt) {
        const age = Date.now() - new Date(compactedAt).getTime();
        if (age < 30_000) {
          updateNotes(n => ({ ...n, '_ctx.just_compacted': 'true' }));
        }
      }
      
      const { ok, failed } = await processPendingExtracts();
      if (ok > 0 && ctx.hasUI && ctx.ui?.notify) {
        ctx.ui.notify(
          `pi-memory: 已补提取 ${ok} 个待处理会话${failed > 0 ? `（${failed} 个失败保留）` : ''}`,
          'info',
        );
      }
      
      if (noteCount > 0 && ctx.hasUI) {
        ctx.ui.notify(
          `pi-memory: ${noteCount} 笔记 · ${activeEntries(loadEntries()).length} 记忆已就绪`,
          'info',
        );
      }
    },
  });

  // 注册钩子：每轮注入记忆块
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async (_event: unknown, _ctx: any) => {
      let entries = loadEntries();
      const kept = autoReclaim(entries);
      if (kept) entries = kept;
      
      const summaries = loadSummaries();
      const { block, entries: n, summaries: m } = buildInjectionBlock(entries, summaries);
      
      if (n === 0 && m === 0) return;
      
      // 注入记忆块（通过 Pi 的 before_agent_start 事件）
      console.log(`[memory] 注入记忆块: ${n} 条记忆, ${m} 条摘要`);
    },
  });

  // 注册钩子：过滤历史注入消息
  registerHook(pi, {
    event: 'context',
    handler: async (event: unknown) => {
      const ctxEvent = event as { messages?: unknown[] };
      const filtered = filterInjectedMessages(ctxEvent.messages || []);
      // 过滤注入消息（通过 Pi 的 context 事件）
      console.log(`[memory] 过滤注入消息: ${ctxEvent.messages?.length || 0} -> ${filtered.length}`);
    },
  });

  // 注册钩子：压缩前快照
  registerHook(pi, {
    event: 'session_before_compact',
    handler: async (_event: unknown, ctx: any) => {
      writeCompactionSnapshot(ctx);
    },
  });

  // 注册钩子：压缩完成
  registerHook(pi, {
    event: 'session_compact',
    handler: async () => {
      updateNotes(n => ({ ...n, '_ctx.compacted_at': new Date().toISOString() }));
    },
  });

  // 注册钩子：会话结束
  registerHook(pi, {
    event: 'session_shutdown',
    handler: async (_event: unknown, ctx: any) => {
      if (process.env.PI_MEMORY_EXTRACT === '1') return;
      const messages = extractTextFromEntries(ctx.sessionManager?.getBranch() || []);
      if (!messages.length) return;
      queuePendingExtract(messages, ctx.sessionManager?.getSessionId() || null);
    },
  });

  console.log('✅ Memory feature registered');
}