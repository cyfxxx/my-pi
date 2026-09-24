/**
 * tmux 完成自动唤醒（迁移自 pi-tools `pi-tmux/watcher.ts`）
 *
 * 背景：`tmux_run` 起后台长任务后回合结束、等待用户输入；任务完成无人通知，
 * 结果要等用户下一轮发消息才被查看。本模块在会话启动后轮询 `tmux has-session`，
 * 会话消失即视为完成，注入一条通知消息并触发新回合——主会话被唤醒后
 * `tmux_read` 查看日志并继续收尾。
 *
 * 本模块为纯逻辑（IO 全部经 {@link WatcherDeps} 注入），可在 vitest 中直接驱动。
 * 风险防范（均有测试覆盖）：
 * - 去重：同会话只通知一次（`notified`）
 * - 防泄漏：定时器 `unref` + `stopAll` + 同名覆盖
 * - 静默容错：`hasSession`/`notify` 异常不抛、不中断轮询
 * - 可控：`notifyEnabled=false` 不注册；成功读取过的会话 `ack` 后不再通知
 * - 缓存友好：通知文本无时间戳等动态内容
 * - 防积压：同轮完成的会话进 `pending`，固定 `MERGE_WINDOW_MS` 窗口合并成一条汇总
 */

export interface WatcherDeps {
	/** 会话是否仍存活（闭包注入 `tmux has-session`） */
	hasSession: (name: string) => Promise<boolean>;
	/** 触发新回合的通知（闭包注入 pi.sendMessage + triggerTurn） */
	notify: (text: string) => Promise<void>;
	/**
	 * 会话自然完成（轮询探测到已消失）时回调——供外部同步清理句柄与注册表引用。
	 * 主动停止（`stop()`/`stopAll()`）不走此回调（`tmux_stop` 由调用方自行清理）。
	 */
	onDone?: (name: string) => void;
}

export interface WatcherHandle {
	stop(): void;
}

export interface CompletionWatcher {
	/** 监听一个 tmux 会话；`notifyEnabled=false` 时返回空句柄（不轮询） */
	watch(name: string, logPath: string, notifyEnabled: boolean): WatcherHandle;
	/** 标记会话已被消费（`tmux_read` 成功读取）：完成时不再通知；已 flush 的无法撤回 */
	ack(name: string): void;
	/** 停止全部监听并清空状态（会话结束/关闭时调用） */
	stopAll(): void;
}

/** 轮询间隔 */
export const POLL_INTERVAL_MS = 5000;
/** 完成通知合并窗口：等于轮询间隔，同轮批量完成的会话合成一条汇总 */
export const MERGE_WINDOW_MS = 5000;
/** 通知消息的 customType（供 UI 区分来源） */
export const NOTIFY_CUSTOM_TYPE = 'pi-tmux-notify';

interface PendingItem {
	name: string;
	logPath: string;
}

export function createCompletionWatcher(deps: WatcherDeps): CompletionWatcher {
	const timers = new Map<string, NodeJS.Timeout>();
	const notified = new Set<string>();
	/** 已被消费（tmux_read）的会话：完成时不通知 */
	const acked = new Set<string>();
	/** 已完成、等待合并窗口 flush 的会话 */
	const pending = new Map<string, PendingItem>();
	let mergeTimer: NodeJS.Timeout | null = null;

	function flush(): void {
		mergeTimer = null;
		if (pending.size === 0) return;
		const items = [...pending.values()];
		pending.clear();
		let text: string;
		if (items.length === 1) {
			const it = items[0];
			text =
				`tmux 会话 ${it.name} 已结束。请用 tmux_read(name=${it.name}) 查看日志并处理收尾。` +
				`日志: ${it.logPath}（tmux_run 自动完成唤醒通知）`;
		} else {
			text =
				`tmux 会话已完成 ${items.length} 个（批量完成通知）：\n` +
				items.map((it) => `- ${it.name}（日志: ${it.logPath}）`).join('\n') +
				'\n请用 tmux_read(name=...) 查看日志并处理收尾（tmux_run 自动完成唤醒通知）';
		}
		deps.notify(text).catch(() => {
			/* 通知失败静默：不因唤醒失败影响主流程 */
		});
	}

	/** 合并窗口从首个完成事件起算（固定窗口不重置，防持续完成导致通知无限推迟） */
	function scheduleFlush(): void {
		if (mergeTimer) return;
		mergeTimer = setTimeout(flush, MERGE_WINDOW_MS);
		mergeTimer.unref?.();
	}

	/** 停止并移除某会话的轮询定时器 */
	function clear(name: string): void {
		const t = timers.get(name);
		if (t) {
			clearInterval(t);
			timers.delete(name);
		}
	}

	function watch(name: string, logPath: string, notifyEnabled: boolean): WatcherHandle {
		// 同名重复注册：旧监听器先停，防多定时器
		clear(name);
		// 同名重新注册 = 新会话启动（tmux_stop 后同名 tmux_run）：旧会话的
		// notified/acked 标记与 pending 条目必须清除，否则新会话结束时不通知
		// （静默丢通知）或误合并旧完成事件
		notified.delete(name);
		acked.delete(name);
		pending.delete(name);
		if (!notifyEnabled) return { stop: () => {} };

		const timer = setInterval(() => {
			void (async () => {
				let alive: boolean;
				try {
					alive = await deps.hasSession(name);
				} catch {
					// tmux 瞬时故障（如服务重启）：静默跳过，下一轮再探，不中断监听
					return;
				}
				if (alive) return;

				clear(name);
				// 自然完成（非 tmux_stop）：通知外部清理句柄与注册表陈旧条目
				deps.onDone?.(name);
				if (notified.has(name)) return;
				notified.add(name);
				if (acked.has(name)) return; // 已被 tmux_read 消费：不打扰
				pending.set(name, { name, logPath });
				scheduleFlush();
			})();
		}, POLL_INTERVAL_MS);
		timer.unref?.();
		timers.set(name, timer);

		return {
			stop() {
				clear(name);
				// 主动停止：会话已人工结束（工具已返回结果），丢弃 pending 条目，
				// 防轮询竞态（已探测到消失但未 flush）触发空通知
				pending.delete(name);
			},
		};
	}

	return {
		watch,
		ack(name: string): void {
			// 已完成但未 flush（pending 中）：直接移除，不再通知
			pending.delete(name);
			// 仍在轮询（未完成）：标记消费，完成时跳过通知
			// （已 flush 的通知已进入队列，无法撤回）
			acked.add(name);
		},
		stopAll(): void {
			for (const name of [...timers.keys()]) clear(name);
			if (mergeTimer) {
				clearTimeout(mergeTimer);
				mergeTimer = null;
			}
			notified.clear();
			acked.clear();
			pending.clear();
		},
	};
}
