/**
 * secrets.ts — 密钥/敏感信息脱敏工具
 *
 * 迁移自 pi-tools core/secrets.ts，供 memory、context 等模块共用。
 * 纯逻辑，零 Pi 依赖。
 */

/** 敏感信息正则模式列表 */
export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // GitHub token（ghp_ 个人 / gho_ OAuth / ghu_ 用户级 / ghs_ 服务器 / ghr_ 刷新 / github_pat_ 精细）
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED:github-token]'],
  // OpenAI/DeepSeek 风格 API key
  [/\bsk-[A-Za-z0-9_-]{15,}\b/g, '[REDACTED:api-key]'],
  // AWS Access Key ID
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED:jwt]'],
  // Authorization Bearer 头
  [/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, '[REDACTED:bearer-token]'],
  // PEM 私钥块（可跨行）
  [
    /\b-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+PRIVATE KEY-----\b/g,
    '[REDACTED:private-key]',
  ],
  // 密码/令牌键值形态（保留原分隔符与空白，避免改写被持久化内容）
  [/\b(password|passwd|secret|api[_-]?key|token|access[_-]?key)(\s*[=:]\s*)['"]?[^\s'",;]{8,}/gi, '$1$2[REDACTED]'],
  // JSON 序列化形态
  [
    /("(?:password|passwd|secret|api[_-]?key|token|access[_-]?key)"\s*:\s*")(?!\[REDACTED)([^"]{8,})(")/gi,
    '$1[REDACTED]$3',
  ],
  // Google API key
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  // Slack token
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, '[REDACTED:slack-token]'],
];

/** 脱敏：将文本中的敏感信息替换为 [REDACTED] 标记 */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}
