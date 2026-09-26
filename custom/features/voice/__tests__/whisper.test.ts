/**
 * whisper /health 短 TTL 缓存回归测试。
 * 核心场景：/voice doctor 连续调用 model/device/status，只允许发一次 /health 请求。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whisperModel, whisperDevice, whisperStatus, resetWhisperHealthCache } from '../stt/whisper';
import { loadConfig, type VoiceConfig } from '../config';

function cfgOf(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return { ...loadConfig({}, '/nonexistent/pi-voice.json'), whisperEndpoint: 'http://127.0.0.1:18766', ...overrides };
}

function responseWith(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('whisper /health 短 TTL 缓存', () => {
  beforeEach(() => {
    resetWhisperHealthCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('model/device/status 连续查询只请求一次', async () => {
    const fetchMock = stubFetch(async () => responseWith({ ok: true, model: 'base', device: 'cuda' }));
    const cfg = cfgOf();
    const model = await whisperModel(cfg);
    const device = await whisperDevice(cfg);
    const status = await whisperStatus(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18766/health', expect.anything());
    expect(model).toBe('base');
    expect(device).toBe('cuda');
    expect(status).toBe('运行中');
  });

  it('并行查询共享同一次探测', async () => {
    const fetchMock = stubFetch(async () => responseWith({ ok: true, model: 'small', device: 'cpu' }));
    const cfg = cfgOf();
    await Promise.all([whisperModel(cfg), whisperDevice(cfg), whisperStatus(cfg)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('失败结果同样缓存：三个函数各得原语义且只等待一次', async () => {
    const fetchMock = stubFetch(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const cfg = cfgOf();
    expect(await whisperModel(cfg)).toBeNull();
    expect(await whisperDevice(cfg)).toBeNull();
    expect(await whisperStatus(cfg)).toBe('不可达（运行 pi-whisper.sh start）');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('JSON 解析失败按不可达处理且缓存', async () => {
    const fetchMock = stubFetch(
      async () =>
        ({
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response,
    );
    const cfg = cfgOf();
    expect(await whisperStatus(cfg)).toContain('不可达');
    expect(await whisperModel(cfg)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TTL 内命中缓存，过期后重新探测', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = stubFetch(async () => responseWith({ ok: true, model: 'base', device: 'cuda' }));
    const cfg = cfgOf();
    await whisperModel(cfg);
    now += 2400;
    await whisperDevice(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 200;
    await whisperStatus(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('不同端点不共享缓存', async () => {
    const fetchMock = stubFetch(async () => responseWith({ ok: true, model: 'base', device: 'cuda' }));
    await whisperModel(cfgOf());
    await whisperModel(cfgOf({ whisperEndpoint: 'http://127.0.0.1:18767' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('服务 ok=false 时沿用原语义（device 仍可取，状态为启动中）', async () => {
    stubFetch(async () => responseWith({ device: 'cpu' }));
    const cfg = cfgOf();
    expect(await whisperModel(cfg)).toBeNull();
    expect(await whisperDevice(cfg)).toBe('cpu');
    expect(await whisperStatus(cfg)).toBe('启动中');
  });
});
