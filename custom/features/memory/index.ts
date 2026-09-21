/**
 * Memory Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-memory/{index,tools,commands}.ts`。
 * 提供 5 个工具（store/search/recall/stats/forget）、`/memory` 命令、
 * 每轮注入块（消息注入，缓存友好）、以及 compaction 标记。
 *
 * 未迁移：LLM 提取（extract.ts）与 ctx_* 工具（exec-sandbox/checkpoint/notes），
 * 留待后续批次。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { registerCommand } from '../../adapters/ui-adapter';
import {
  loadEntries,
  loadSummaries,
  loadNotes,
  updateNotes,
  activeEntries,
  autoReclaim,
  storeEntry,
  saveEntries,
  deleteEntry,
  pruneEntries,
  getStats,
  getTotalSize,
  touchAccessedAt,
  searchEntriesWithScores,
  logSearchTrace,
  buildInjectionBlock,
  INJECT_TAG,
  filterInjectedMessages,
  detectEnvironment,
  formatEnvironments,
  CATEGORIES,
  ENVIRONMENTS,
} from './logic';
import type { MemoryCategory, MemoryEntry, RuntimeEnv } from './logic';

export function register(pi: ExtensionAPI): void {
  // ── memory_store ──
  registerTool(pi, {
    name: 'memory_store',
    description:
      '存储知识到持久记忆库（发现新信息/偏好/项目约定/API 用法时调用）。自动去重：同标题更新、近似内容合并。',
    parameters: {
      category: { type: 'string', enum: CATEGORIES, description: '类别: fact/preference/habit/procedure/reference/solutions' },
      title: { type: 'string', description: '简短标题，作搜索索引' },
      content: { type: 'string', description: '详细内容' },
      tags: { type: 'string[]', description: '标签数组', optional: true },
      confidence: { type: 'number', description: '置信度 0-1（直接事实 1.0，推断 0.5-0.7）', optional: true },
      environment: { type: 'string', enum: ENVIRONMENTS, description: '适用运行环境（缺省 all）', optional: true },
    },
    execute: async (params) => {
      const entries = loadEntries();
      const entry: MemoryEntry = {
        id: randomUUID(),
        category: params.category as MemoryCategory,
        title: params.title as string,
        content: params.content as string,
        tags: (params.tags as string[]) || [],
        confidence: typeof params.confidence === 'number' ? params.confidence : 0.7,
        source: 'manual',
        recurrence: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accessedAt: new Date().toISOString(),
        environments: params.environment ? [params.environment as RuntimeEnv] : ['all'],
      };
      const { action } = storeEntry(entries, entry);
      const totalSize = getTotalSize(entries);
      const actionMap: Record<string, string> = { created: '新存入', merged: '合并到已有条目', updated: '更新已有条目' };
      let msg = `已${actionMap[action]}记忆: "${entry.title}" (${entry.category})`;
      if (totalSize > 1800 * 1024) {
        msg += `\n警告: 记忆库 ${(totalSize / (1024 * 1024)).toFixed(1)} MB，接近 2 MB 上限，请 /memory prune 清理`;
      }
      return msg;
    },
  });

  // ── memory_stats ──
  registerTool(pi, {
    name: 'memory_stats',
    description: '查看持久记忆库统计：条目总数、类别分布、存储大小、冷数据、摘要数。',
    parameters: {},
    execute: async () => {
      const stats = getStats(loadEntries());
      const sizeMB = (stats.totalSizeBytes / (1024 * 1024)).toFixed(2);
      const categoryLines = Object.entries(stats.byCategory)
        .map(([cat, count]) => `  ${cat}: ${count} 条`)
        .join('\n');
      return [
        '记忆库统计:',
        `  总条目: ${stats.totalEntries}（活跃 ${stats.activeEntries}）`,
        `  存储大小: ${sizeMB} MB / 2 MB`,
        `  会话摘要: ${stats.summaries} 条`,
        `  被取代条目: ${stats.superseded} 条`,
        `  冷数据(>30天未访问): ${stats.coldEntries} 条`,
        '  分类:',
        categoryLines || '  (空)',
        stats.oldestEntry ? `  最早记录: ${stats.oldestEntry.slice(0, 10)}` : '',
        stats.newestEntry ? `  最新记录: ${stats.newestEntry.slice(0, 10)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  });

  // ── memory_forget ──
  registerTool(pi, {
    name: 'memory_forget',
    description: '删除记忆。按 id 精确删除，或按类别+时间范围批量删除。',
    parameters: {
      id: { type: 'string', description: '要删除的记忆条目 ID', optional: true },
      category: { type: 'string', enum: CATEGORIES, description: '按类别批量删除（需同时 olderThan）', optional: true },
      olderThan: { type: 'string', description: 'ISO 日期，删除该日期之前创建且匹配 category 的记忆', optional: true },
    },
    execute: async (params) => {
      const entries = loadEntries();
      const id = params.id as string | undefined;
      const category = params.category as MemoryCategory | undefined;
      const olderThan = params.olderThan as string | undefined;

      if (id) {
        return deleteEntry(entries, id) ? `已删除记忆 ${id}` : `未找到记忆 ${id}`;
      }
      if (category && olderThan) {
        const cutoff = new Date(olderThan).getTime();
        if (Number.isNaN(cutoff)) return `无效日期: ${olderThan}`;
        const before = entries.length;
        const removedIds = new Set<string>();
        const kept = entries.filter((e) => {
          if (e.category !== category) return true;
          if (new Date(e.createdAt).getTime() > cutoff) return true;
          removedIds.add(e.id);
          return false;
        });
        const removed = before - kept.length;
        entries.length = 0;
        entries.push(...kept);
        saveEntries(entries, { excludeIds: removedIds });
        return `已删除 ${removed} 条 ${category} 类别记忆（${olderThan} 之前）`;
      }
      return '请指定 id，或同时指定 category 和 olderThan';
    },
  });

  // ── memory_search ──
  registerTool(pi, {
    name: 'memory_search',
    description:
      '从持久记忆库检索知识。支持关键词/类别/标签过滤，结果按相关度排序（BM25 + 置信度/时效/引用频率）。',
    parameters: {
      query: { type: 'string', description: '搜索关键词（匹配标题、标签、内容）', optional: true },
      category: { type: 'string', enum: CATEGORIES, description: '按类别过滤', optional: true },
      tags: { type: 'string[]', description: '按标签过滤', optional: true },
      limit: { type: 'number', description: '返回条数上限（默认 5）', optional: true },
      env: { type: 'string', enum: ENVIRONMENTS, description: '按运行环境过滤（缺省=当前环境+all）', optional: true },
      asOf: { type: 'string', description: 'ISO 时间点：返回该时刻有效的记忆（回溯查询）', optional: true },
    },
    execute: async (params) => {
      const t0 = Date.now();
      const entries = loadEntries();
      const envFilter: RuntimeEnv | 'all' = params.env ? (params.env as RuntimeEnv) : detectEnvironment();
      const scored = searchEntriesWithScores(
        entries,
        params.query as string | undefined,
        params.category as MemoryCategory | undefined,
        params.tags as string[] | undefined,
        typeof params.limit === 'number' ? params.limit : 5,
        envFilter,
        typeof params.asOf === 'string' ? params.asOf : undefined,
      );
      const results = scored.map((x) => x.entry);
      touchAccessedAt(entries, results.map((e) => e.id));
      logSearchTrace({
        caller: 'memory_search',
        query: params.query as string | undefined,
        category: params.category as string | undefined,
        tags: params.tags as string[] | undefined,
        limit: typeof params.limit === 'number' ? params.limit : 5,
        hits: scored.map((x) => ({ id: x.entry.id, title: x.entry.title, score: x.score })),
        tookMs: Date.now() - t0,
      });
      if (!results.length) return '(无匹配的记忆)';
      const lines = results.map((e, i) => {
        const age = Math.round((Date.now() - new Date(e.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const linkNote = e.links?.length ? ` ↔关联${e.links.length}条` : '';
        return `${i + 1}. [${e.category}] ${e.title}（${formatEnvironments(e.environments)}）${linkNote}
   置信度: ${e.confidence} | 引用: ${e.recurrence} 次 | ${age} 天前
   ${e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content}`;
      });
      return `记忆搜索结果 (${results.length} 条):\n${lines.join('\n')}`;
    },
  });

  // ── memory_recall ──
  registerTool(pi, {
    name: 'memory_recall',
    description: '综合检索长期记忆与历史会话摘要，用于跨会话衔接。',
    parameters: {
      query: { type: 'string', description: '检索关键词（可空：仅返回高质量记忆）', optional: true },
      limit: { type: 'number', description: '记忆条数上限（默认 3）', optional: true },
      summaries: { type: 'boolean', description: '是否附带最近会话摘要（默认 false）', optional: true },
    },
    execute: async (params) => {
      const t0 = Date.now();
      const entries = loadEntries();
      const limit = typeof params.limit === 'number' ? params.limit : 3;
      const scored = searchEntriesWithScores(entries, params.query as string | undefined, undefined, undefined, limit, detectEnvironment());
      const results = scored.map((x) => x.entry);
      touchAccessedAt(entries, results.map((e) => e.id));
      logSearchTrace({
        caller: 'memory_recall',
        query: params.query as string | undefined,
        limit,
        hits: scored.map((x) => ({ id: x.entry.id, title: x.entry.title, score: x.score })),
        tookMs: Date.now() - t0,
      });
      const blocks: string[] = [];
      blocks.push(
        results.length
          ? '相关记忆:\n' + results.map((e, i) => `${i + 1}. [${e.category}] ${e.title}: ${e.content.slice(0, 200)}`).join('\n')
          : '(无相关记忆)',
      );
      if (params.summaries === true) {
        const summaries = [...loadSummaries()].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 5);
        blocks.push(
          summaries.length
            ? '最近会话摘要:\n' +
                summaries.map((s, i) => `${i + 1}. ${s.ts.slice(0, 10)} 「${s.title}」 — ${s.fullText.slice(0, 150)}`).join('\n')
            : '(暂无会话摘要)',
        );
      }
      return blocks.join('\n\n');
    },
  });

  // ── /memory 命令 ──
  registerCommand(pi, 'memory', {
    description: '记忆库管理 (usage: /memory <search|stats|summary|prune|cleanup|help> [args])',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: 'search', label: 'search <关键词> - 搜索记忆' },
        { value: 'stats', label: 'stats - 查看记忆库统计' },
        { value: 'summary', label: 'summary - 查看会话摘要' },
        { value: 'prune', label: 'prune - 清理失效记忆' },
        { value: 'cleanup', label: 'cleanup - 清理过期笔记' },
        { value: 'help', label: 'help - 显示帮助信息' },
      ];
      const filtered = subs.filter((s) => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0] || 'stats';
      const keyword = parts.slice(1).join(' ');
      const helpText = `记忆库管理命令:

用法: /memory <子命令> [参数]

子命令:
  search <关键词>  搜索已存储的记忆
  stats            查看记忆库统计
  summary          查看会话摘要
  prune            清理失效记忆
  cleanup          清理过期笔记
  help             显示帮助`;

      switch (sub) {
        case 'help':
          ctx.ui.notify(helpText, 'info');
          break;
        case 'search': {
          if (!keyword) {
            ctx.ui.notify('用法: /memory search <关键词>', 'info');
            return;
          }
          const entries = loadEntries();
          const results = searchEntriesWithScores(entries, keyword, undefined, undefined, 10, detectEnvironment()).map((x) => x.entry);
          ctx.ui.notify(
            results.length
              ? `匹配 ${results.length} 条:\n${results.map((e) => `- [${e.category}] ${e.title}: ${e.content.slice(0, 80)}`).join('\n')}`
              : `未找到包含「${keyword}」的记忆`,
            'info',
          );
          break;
        }
        case 'stats': {
          const s = getStats(loadEntries());
          ctx.ui.notify(
            `记忆库统计:\n总条目: ${s.totalEntries}（活跃 ${s.activeEntries}）\n存储: ${(s.totalSizeBytes / 1024).toFixed(0)} KB\n摘要: ${s.summaries}\n冷数据: ${s.coldEntries}`,
            'info',
          );
          break;
        }
        case 'summary': {
          const summaries = loadSummaries();
          ctx.ui.notify(
            summaries.length
              ? `会话摘要 (${summaries.length}):\n${summaries.slice(-10).map((s) => `- ${s.ts.slice(0, 10)} ${s.title}`).join('\n')}`
              : '暂无会话摘要',
            'info',
          );
          break;
        }
        case 'prune': {
          const entries = loadEntries();
          const { removed, titles } = pruneEntries(entries);
          ctx.ui.notify(`已清理 ${removed} 条失效记忆${titles.length ? ': ' + titles.slice(0, 10).join(', ') : ''}`, 'info');
          break;
        }
        case 'cleanup': {
          const notes = Object.keys(loadNotes()).filter((k) => !k.startsWith('__'));
          ctx.ui.notify(`清理完成（当前笔记 ${notes.length} 条）`, 'info');
          break;
        }
        default:
          ctx.ui.notify(`未知子命令: ${sub}\n\n${helpText}`, 'info');
      }
    },
  });

  // ── 会话开始：就绪提示 ──
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      const notes = loadNotes();
      const noteCount = Object.keys(notes).filter((k) => !k.startsWith('__') && !k.startsWith('_ctx.')).length;
      const compactedAt = notes['_ctx.compacted_at'];
      if (compactedAt && Date.now() - new Date(compactedAt).getTime() < 30_000) {
        updateNotes((n) => {
          n['_ctx.just_compacted'] = 'true';
        });
      }
      if (noteCount > 0 && ctx.hasUI) {
        ctx.ui.notify(`记忆已就绪: ${noteCount} 笔记 · ${activeEntries(loadEntries()).length} 记忆`, 'info');
      }
    },
  });

  // ── 每轮注入（消息注入，缓存友好）──
  registerHook(pi, {
    event: 'before_agent_start',
    handler: async () => {
      let entries = loadEntries();
      const kept = autoReclaim(entries);
      if (kept) entries = kept;
      const { block, entries: n, summaries: m } = buildInjectionBlock(entries, loadSummaries());
      if (n === 0 && m === 0) return undefined;
      return { message: { customType: INJECT_TAG, content: block, display: false } };
    },
  });

  // ── 过滤历史注入消息（只保留最新一条）──
  registerHook(pi, {
    event: 'context',
    handler: async (event) => {
      const e = event as { messages?: object[] };
      if (!Array.isArray(e.messages)) return undefined;
      return { messages: filterInjectedMessages(e.messages) };
    },
  });

  // ── compaction 完成：记录时间戳 ──
  registerHook(pi, {
    event: 'session_compact',
    handler: async () => {
      updateNotes((n) => {
        n['_ctx.compacted_at'] = new Date().toISOString();
      });
    },
  });
}
