import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWarmPrefixState,
  needsWarmPrefix,
  isSummarizationMessage,
  extractMessageText,
  extractTailFromSummarization,
  canReplayWarmPrefix,
  buildReplayedPayload,
  canProvideWarmPrefix,
  buildWarmPrefixData,
  saveMainRequestPayload,
  updateCompactWarmAllowed,
  AUTO_PREFIX_CACHE_REGEX,
  CONV_TAG_REGEX,
} from '../budget/warm-prefix';

describe('context/budget/warm-prefix: 状态管理', () => {
  beforeEach(() => {
    // 重置状态
  });

  it('createWarmPrefixState 创建初始状态', () => {
    const state = createWarmPrefixState();
    expect(state.lastModelKey).toBe('');
    expect(state.lastRequestPayload).toBeNull();
    expect(state.compactWarmAllowed).toBe(false);
  });

  it('saveMainRequestPayload 保存主请求', () => {
    const state = createWarmPrefixState();
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const tools = [{ name: 'test_tool' }];

    saveMainRequestPayload(state, 'gpt-3.5-turbo', messages, tools);

    expect(state.lastModelKey).toBe('gpt-3.5-turbo');
    expect(state.lastRequestPayload).not.toBeNull();
    if (state.lastRequestPayload) {
      expect(state.lastRequestPayload.messages).toHaveLength(2);
      expect(state.lastRequestPayload.tools).toEqual(tools);
    }
  });

  it('updateCompactWarmAllowed 更新压缩暖前缀允许状态', () => {
    const state = createWarmPrefixState();

    // 非 overflow 且 token 占用 < 90% 时允许
    updateCompactWarmAllowed(state, 'idle', 1000, 800);
    expect(state.compactWarmAllowed).toBe(true);

    // overflow 原因时不允许
    updateCompactWarmAllowed(state, 'overflow', 1000, 800);
    expect(state.compactWarmAllowed).toBe(false);

    // 非 overflow 但 token 占用 >= 90% 时不允许
    updateCompactWarmAllowed(state, 'idle', 1000, 950);
    expect(state.compactWarmAllowed).toBe(false);
  });
});

describe('context/budget/warm-prefix: 模型匹配', () => {
  it('needsWarmPrefix 正确识别需要重放前缀的模型', () => {
    const supportedModels = [
      'deepseek-coder',
      'qwen-turbo',
      'kimi-chat',
      'moonshot-v1',
      'glm-4',
      'zhipu-cog',
      'doubao-pro',
      'gemini-pro',
      'gpt-3.5-turbo',
      'gpt-4',
      'o1-preview',
      'o3-mini',
    ];

    supportedModels.forEach((model) => {
      expect(needsWarmPrefix(model)).toBe(true);
    });

    const unsupportedModels = [
      'llama2',
      'mistral',
      'codellama',
      'claude-2',
    ];

    unsupportedModels.forEach((model) => {
      expect(needsWarmPrefix(model)).toBe(false);
    });
  });

  it('AUTO_PREFIX_CACHE_REGEX 常量可用', () => {
    expect(AUTO_PREFIX_CACHE_REGEX).toBeDefined();
    expect(typeof AUTO_PREFIX_CACHE_REGEX.test).toBe('function');
  });
});

describe('context/budget/warm-prefix: 摘要检测', () => {
  it('isSummarizationMessage 正确识别摘要消息', () => {
    expect(isSummarizationMessage({ role: 'user', content: '<conversation>\n摘要内容\n</conversation>' })).toBe(true);
    expect(isSummarizationMessage({ role: 'user', content: '开始总结<conversation>\n内容\n</conversation>\n结束' })).toBe(true);
    expect(isSummarizationMessage({ role: 'assistant', content: '<conversation>\n内容\n</conversation>' })).toBe(false);
    expect(isSummarizationMessage({ role: 'user', content: '普通消息' })).toBe(false);
    expect(isSummarizationMessage({ role: 'user', content: null })).toBe(false);
    expect(isSummarizationMessage({ role: 'user' })).toBe(false);
  });

  it('CONV_TAG_REGEX 常量可用', () => {
    expect(CONV_TAG_REGEX).toBeDefined();
    expect(typeof CONV_TAG_REGEX.test).toBe('function');
  });
});

describe('context/budget/warm-prefix: 内容提取', () => {
  it('extractMessageText 提取字符串内容', () => {
    expect(extractMessageText('直接文本')).toBe('直接文本');
  });

  it('extractMessageText 提取数组内容中的文本块', () => {
    const content = [
      { type: 'text', text: '第一段' },
      { type: 'image_url', image_url: { url: 'http://example.com/img.jpg' } },
      { type: 'text', text: '第二段' },
    ];
    expect(extractMessageText(content)).toBe('第一段\n\n第二段');
  });

  it('extractMessageText 处理空数组和无效内容', () => {
    expect(extractMessageText([])).toBe('');
    expect(extractMessageText([{ type: 'image_url' } as any])).toBe('');
    expect(extractMessageText(null)).toBe('');
    expect(extractMessageText(undefined)).toBe('');
  });

  it('extractTailFromSummarization 提取尾部内容', () => {
    const input = '<conversation>\n这是摘要内容\n</conversation>\n\n这是需要保留的尾部内容';
    const tail = extractTailFromSummarization(input);
    expect(tail).toBe('这是需要保留的尾部内容');
  });

  it('extractTailFromSummarization 处理无效输入', () => {
    expect(extractTailFromSummarization('无标签内容')).toBeNull();
    expect(extractTailFromSummarization('<conversation>\n只包含摘要\n</conversation>\n\n')).toBeNull();
    expect(extractTailFromSummarization('')).toBeNull();
  });
});

describe('context/budget/warm-prefix: 重放判定', () => {
  it('canReplayWarmPrefix 满足所有条件时返回 true', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '原始问题' }],
      tools: [{ name: 'test' }],
    };

    const messages = [
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: '原始回答' },
      { role: 'user', content: '<conversation>\n摘要\n</conversation>\n\n这是更新内容' },
    ];

    expect(canReplayWarmPrefix(state, 'gpt-3.5-turbo', messages)).toBe(true);
  });

  it('canReplayWarmPrefix 模型不支持时返回 false', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'llama2'; // 不支持的模型
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '原始问题' }],
      tools: [{ name: 'test' }],
    };

    const messages = [
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: '原始回答' },
      { role: 'user', content: '<conversation>\n摘要\n</conversation>\n\n这是更新内容' },
    ];

    expect(canReplayWarmPrefix(state, 'llama2', messages)).toBe(false);
  });

  it('canReplayWarmPrefix 无主请求时返回 false', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.lastRequestPayload = null; // 无主请求

    const messages = [
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: '原始回答' },
      { role: 'user', content: '<conversation>\n摘要\n</conversation>\n\n这是更新内容' },
    ];

    expect(canReplayWarmPrefix(state, 'gpt-3.5-turbo', messages)).toBe(false);
  });

  it('canReplayWarmPrefix 消息为空时返回 false', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '原始问题' }],
      tools: [{ name: 'test' }],
    };

    expect(canReplayWarmPrefix(state, 'gpt-3.5-turbo', [])).toBe(false);
  });

  it('canReplayWarmPrefix 最后一条消息不是摘要时返回 false', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '原始问题' }],
      tools: [{ name: 'test' }],
    };

    const messages = [
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: '原始回答' },
      { role: 'user', content: '普通更新内容' }, // 不是摘要消息
    ];

    expect(canReplayWarmPrefix(state, 'gpt-3.5-turbo', messages)).toBe(false);
  });
});

describe('context/budget/warm-prefix: 重放构建', () => {
  it('buildReplayedPayload 构建正确的重放请求', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.lastRequestPayload = {
      messages: [
        { role: 'user', content: '原始系统提示' },
        { role: 'user', content: '原始用户问题' },
      ],
      tools: [{ name: 'tool1' }, { name: 'tool2' }],
    };

    const payload = {
      messages: [
        { role: 'user', content: '原始系统提示' },
        { role: 'user', content: '原始用户问题' },
        { role: 'assistant', content: '原始AI回答' },
        { role: 'user', content: '<conversation>\n会话摘要\n</conversation>\n\n需要添加的新内容' },
      ],
      tools: [{ name: 'tool1' }, { name: 'tool2' }],
    };

    const result = buildReplayedPayload(state, payload.messages, payload);
    expect(result).not.toBeNull();

    if (result) {
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages).toHaveLength(3); // 原始2条 + 新增1条 tail
      const msgs = result.messages as { role?: string; content?: string }[];
      expect(msgs[0] && typeof msgs[0] === 'object').toBe(true);
      expect(msgs[0]?.role).toBe('user');
      expect(msgs[0]?.content).toBe('原始系统提示');
      expect(msgs[1] && typeof msgs[1] === 'object').toBe(true);
      expect(msgs[1]?.role).toBe('user');
      expect(msgs[1]?.content).toBe('原始用户问题');
      expect(msgs[2] && typeof msgs[2] === 'object').toBe(true);
      expect(msgs[2]?.role).toBe('user');
      expect(msgs[2]?.content).toBe('需要添加的新内容');
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools).toHaveLength(2);
    }
  });

  it('buildReplayedPayload 条件不满足时返回 null', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'llama2'; // 不支持的模型
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '原始问题' }],
      tools: [{ name: 'test' }],
    };

    const payload = {
      messages: [
        { role: 'user', content: '原始问题' },
        { role: 'user', content: '<conversation>\n摘要\n</conversation>\n\n更新内容' },
      ],
      tools: [{ name: 'test' }],
    };

    expect(buildReplayedPayload(state, payload.messages, payload)).toBeNull();
  });
});

describe('context/budget/warm-prefix: 暖前缀数据提供', () => {
  it('canProvideWarmPrefix 满足条件时返回 true', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.compactWarmAllowed = true;
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: '测试消息' }],
      tools: [{ name: 'tool1' }, { name: 'tool2' }], // 有 tools 数据
    };

    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(true);
  });

  it('canProvideWarmPrefix 各项条件不满足时返回 false', () => {
    const baseState = createWarmPrefixState();
    baseState.lastModelKey = 'gpt-3.5-turbo';
    baseState.lastRequestPayload = {
      messages: [{ role: 'user', content: '测试消息' }],
      tools: [{ name: 'tool1' }, { name: 'tool2' }],
    };

    // compactWarmAllowed 为 false
    let state = { ...baseState, compactWarmAllowed: false };
    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(false);

    // 模型不支持
    state = { ...baseState, compactWarmAllowed: true, lastModelKey: 'llama2' };
    expect(canProvideWarmPrefix(state, 'llama2')).toBe(false);

    // 无 lastRequestPayload
    state = { ...baseState, compactWarmAllowed: true, lastRequestPayload: null };
    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(false);

    // lastRequestPayload 消息为空
    state = {
      ...baseState,
      compactWarmAllowed: true,
      lastRequestPayload: { messages: [], tools: [{ name: 'tool1' }] },
    };
    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(false);

    // 无 tools 数据
    state = {
      ...baseState,
      compactWarmAllowed: true,
      lastRequestPayload: { messages: [{ role: 'user', content: 'test' }], tools: [] },
    };
    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(false);

    // tools 不是数组
    state = {
      ...baseState,
      compactWarmAllowed: true,
      lastRequestPayload: { messages: [{ role: 'user', content: 'test' }], tools: {} as any },
    };
    expect(canProvideWarmPrefix(state, 'gpt-3.5-turbo')).toBe(false);
  });

  it('buildWarmPrefixData 构建正确的暖前缀数据', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'gpt-3.5-turbo';
    state.compactWarmAllowed = true;
    state.lastRequestPayload = {
      messages: [
        { role: 'user', content: '系统提示' },
        { role: 'user', content: '用户问题' },
      ],
      tools: [{ name: 'tool1' }, { name: 'tool2' }],
    };

    const result = buildWarmPrefixData(state);
    expect(result).not.toBeNull();

    if (result) {
      expect(result.systemPrompt).toBe('');
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools).toHaveLength(2);
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({ role: 'user', content: '系统提示' });
      expect(result.messages[1]).toEqual({ role: 'user', content: '用户问题' });
    }
  });

  it('buildWarmPrefixData 条件不满足时返回 null', () => {
    const state = createWarmPrefixState();
    state.lastModelKey = 'llama2'; // 不支持的模型
    state.compactWarmAllowed = true;
    state.lastRequestPayload = {
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ name: 'tool1' }],
    };

    expect(buildWarmPrefixData(state)).toBeNull();
  });
});