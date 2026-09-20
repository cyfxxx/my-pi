import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '../secrets';

describe('secrets: scrubSecrets', () => {
  it('github token', () => {
    expect(scrubSecrets('token ghp_' + 'a'.repeat(36))).toContain('[REDACTED:github-token]');
  });

  it('openai/api key', () => {
    expect(scrubSecrets('key sk-abcdefghijklmnop1234')).toContain('[REDACTED:api-key]');
  });

  it('key=value 形态', () => {
    expect(scrubSecrets('password=hunter2hunter2')).toContain('[REDACTED]');
  });

  it('JSON 序列化形态', () => {
    const out = scrubSecrets('{"api_key": "abcdefghijklmnop"}');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('abcdefghijklmnop');
  });

  it('普通文本不受影响', () => {
    expect(scrubSecrets('hello world')).toBe('hello world');
  });
});
