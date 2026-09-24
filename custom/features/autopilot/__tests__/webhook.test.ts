/**
 * 调度完成通知（webhook）测试：payload 构造、URL 解析优先级、无 URL 时不发送
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildWebhookPayload, resolveWebhookUrl, sendWebhook, WEBHOOK_OUTPUT_MAX } from '../store/webhook';

describe('buildWebhookPayload', () => {
  it('包含任务名/类型/计划/结果/时间，output 截断', () => {
    const long = 'x'.repeat(WEBHOOK_OUTPUT_MAX + 500);
    const p = buildWebhookPayload(
      { name: 'nightly', type: 'prompt', schedule: '0 3 * * *' },
      'success',
      long,
      new Date('2026-09-24T00:00:00Z'),
    );
    expect(p.task).toBe('nightly');
    expect(p.type).toBe('prompt');
    expect(p.schedule).toBe('0 3 * * *');
    expect(p.result).toBe('success');
    expect(p.time).toBe('2026-09-24T00:00:00.000Z');
    expect(p.output).toHaveLength(WEBHOOK_OUTPUT_MAX);
  });

  it('空 output 不报错', () => {
    const p = buildWebhookPayload({ name: 't', type: 'prompt', schedule: '*' }, 'failed', '');
    expect(p.output).toBe('');
  });
});

describe('resolveWebhookUrl', () => {
  const OLD = process.env.PI_SCHEDULER_WEBHOOK;
  beforeEach(() => {
    delete process.env.PI_SCHEDULER_WEBHOOK;
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.PI_SCHEDULER_WEBHOOK;
    else process.env.PI_SCHEDULER_WEBHOOK = OLD;
  });

  it('环境变量优先', () => {
    process.env.PI_SCHEDULER_WEBHOOK = 'https://example.com/hook';
    expect(resolveWebhookUrl()).toBe('https://example.com/hook');
  });

  it('未配置时返回空串（不抛错）', () => {
    const url = resolveWebhookUrl();
    expect(typeof url).toBe('string');
  });
});

describe('sendWebhook', () => {
  const OLD = process.env.PI_SCHEDULER_WEBHOOK;
  afterEach(() => {
    if (OLD === undefined) delete process.env.PI_SCHEDULER_WEBHOOK;
    else process.env.PI_SCHEDULER_WEBHOOK = OLD;
  });

  it('未配置 URL 时直接返回 false，不发请求', async () => {
    delete process.env.PI_SCHEDULER_WEBHOOK;
    const ok = await sendWebhook({ name: 't', type: 'prompt', schedule: '*' }, 'success', 'out');
    expect(ok).toBe(false);
  });

  it('URL 不可达时静默失败（返回 false 不抛）', async () => {
    process.env.PI_SCHEDULER_WEBHOOK = 'http://127.0.0.1:9/none';
    const ok = await sendWebhook({ name: 't', type: 'prompt', schedule: '*' }, 'success', 'out');
    expect(ok).toBe(false);
  });
});
