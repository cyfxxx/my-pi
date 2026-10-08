/**
 * tmux 完成自动唤醒（watcher）测试
 * 重点：去重、ack 消费、合并窗口、同名重注册、stop/stopAll 清理、异常静默
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCompletionWatcher, createIdleGate, POLL_INTERVAL_MS, MERGE_WINDOW_MS } from '../watcher';

type HasSession = (name: string) => Promise<boolean>;

describe('createCompletionWatcher', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function setup(hasSession: HasSession, onDone?: (name: string) => void) {
		const notify = vi.fn<(text: string) => Promise<void>>(async () => {});
		const watcher = createCompletionWatcher({ hasSession, notify, onDone });
		return { watcher, notify };
	}

	it('会话存活时不通知', async () => {
		const { watcher, notify } = setup(async () => true);
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
		expect(notify).not.toHaveBeenCalled();
		watcher.stopAll();
	});

	it('会话结束后发一条通知，含 tmux_read 提示与日志路径', async () => {
		const { watcher, notify } = setup(async () => false);
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(1);
		const text = notify.mock.calls[0][0];
		expect(text).toContain('tmux 会话 a 已结束');
		expect(text).toContain('tmux_read(name=a)');
		expect(text).toContain('/log/a');
		watcher.stopAll();
	});

	it('同会话只通知一次（去重），且 onDone 只回调一次', async () => {
		const onDone = vi.fn();
		const { watcher, notify } = setup(async () => false, onDone);
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5 + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(onDone).toHaveBeenCalledTimes(1);
		watcher.stopAll();
	});

	it('ack 后的会话完成时不通知', async () => {
		const { watcher, notify } = setup(async () => false);
		watcher.watch('a', '/log/a', true);
		watcher.ack('a');
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS);
		expect(notify).not.toHaveBeenCalled();
		watcher.stopAll();
	});

	it('notifyEnabled=false 时不轮询不通知', async () => {
		const hasSession = vi.fn(async () => false);
		const { watcher, notify } = setup(hasSession);
		watcher.watch('a', '/log/a', false);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3 + MERGE_WINDOW_MS);
		expect(hasSession).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
		watcher.stopAll();
	});

	it('同轮完成的多个会话合并为一条汇总通知', async () => {
		const { watcher, notify } = setup(async () => false);
		watcher.watch('a', '/log/a', true);
		watcher.watch('b', '/log/b', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(1);
		const text = notify.mock.calls[0][0];
		expect(text).toContain('批量完成通知');
		expect(text).toContain('- a（日志: /log/a）');
		expect(text).toContain('- b（日志: /log/b）');
		watcher.stopAll();
	});

	it('stop() 丢弃 pending，不产生通知', async () => {
		const { watcher, notify } = setup(async () => false);
		const handle = watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // 已探到消失，进 pending
		handle.stop();
		await vi.advanceTimersByTimeAsync(MERGE_WINDOW_MS * 2);
		expect(notify).not.toHaveBeenCalled();
		watcher.stopAll();
	});

	it('同名重新注册会清除旧标记（新会话结束后仍能通知）', async () => {
		let alive = true;
		const onDone = vi.fn();
		const { watcher, notify } = setup(async () => alive, onDone);
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // 存活
		alive = false;
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS); // 完成并通知
		expect(notify).toHaveBeenCalledTimes(1);

		// 同名新会话（tmux_stop 后再 tmux_run）
		alive = true;
		watcher.watch('a', '/log/a2', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // 存活
		alive = false;
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(2);
		expect(notify.mock.calls[1][0]).toContain('/log/a2');
		watcher.stopAll();
	});

	it('hasSession 抛错时静默跳过，后续轮询仍生效', async () => {
		let calls = 0;
		const { watcher, notify } = setup(async () => {
			calls += 1;
			if (calls === 1) throw new Error('tmux down');
			return false;
		});
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(1);
		watcher.stopAll();
	});

	it('notify 失败不影响后续（不抛到调用方）', async () => {
		const notify = vi.fn<(text: string) => Promise<void>>(async () => {
			throw new Error('inject failed');
		});
		const watcher = createCompletionWatcher({ hasSession: async () => false, notify });
		watcher.watch('a', '/log/a', true);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + MERGE_WINDOW_MS);
		expect(notify).toHaveBeenCalledTimes(1);
		watcher.stopAll();
	});

	it('stopAll 清空定时器与标记（不再触发）', async () => {
		const { watcher, notify } = setup(async () => false);
		watcher.watch('a', '/log/a', true);
		watcher.stopAll();
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3 + MERGE_WINDOW_MS);
		expect(notify).not.toHaveBeenCalled();
	});
});

/**
 * 空闲门（2026-10-07）：pi 在 agent 忙碌时收到 `triggerTurn` 会**直接致命报错**、
 * 进程 rc=1、catch 不住。tmux 会话随时可能结束，所以完成通知必须过门：
 * 忙则入队，只在 `agent_settled`（可安全 triggerTurn 的时刻）合并发出。
 * 这组测试钉住"**宁可晚，不可炸**"——忙的时候一条都不能发。
 */
describe('createIdleGate', () => {
	function setup() {
		const sent: string[] = [];
		const gate = createIdleGate((t) => sent.push(t));
		return { gate, sent };
	}

	it('空闲时立即发送', () => {
		const { gate, sent } = setup();
		gate.notify('done');
		expect(sent).toEqual(['done']);
		expect(gate.pendingCount()).toBe(0);
	});

	it('忙碌时只入队，绝不发送（这是防 rc=1 的关键）', () => {
		const { gate, sent } = setup();
		gate.setBusy(true);
		gate.notify('done-a');
		gate.notify('done-b');
		expect(sent).toEqual([]);
		expect(gate.pendingCount()).toBe(2);
	});

	it('转为空闲时把队列合并成一条发出', () => {
		const { gate, sent } = setup();
		gate.setBusy(true);
		gate.notify('done-a');
		gate.notify('done-b');
		gate.setBusy(false);
		expect(sent).toEqual(['done-a\n\ndone-b']);
		expect(gate.pendingCount()).toBe(0);
	});

	it('再次 setBusy(false) 不重发已清空的队列', () => {
		const { gate, sent } = setup();
		gate.setBusy(true);
		gate.notify('x');
		gate.setBusy(false);
		gate.setBusy(false);
		expect(sent).toEqual(['x']);
	});

	it('空闲→忙→空闲 期间到达的通知落在正确的一侧', () => {
		const { gate, sent } = setup();
		gate.notify('first'); // 空闲：立即发
		gate.setBusy(true);
		gate.notify('queued'); // 忙：入队
		gate.setBusy(false); // 空闲：发出队列
		gate.notify('second'); // 空闲：立即发
		expect(sent).toEqual(['first', 'queued', 'second']);
	});
});
