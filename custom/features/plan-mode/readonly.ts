/**
 * Plan-mode Feature — 只读 bash 判定（纯逻辑，零 Pi 依赖）
 *
 * 计划模式禁止模型执行会写盘的 bash。判定分三步：
 *   1. 剥离引号后拒绝 shell 元字符（; & | < > ` 换行）与命令替换（$( ${）
 *   2. 首词命中只读命令白名单
 *   3. 对可写标志做逐命令拦截（sort -o、date -s、find -delete/-exec 等）
 * git 仅允许只读子命令。无法确证的命令一律拒绝（fail-closed）。
 */

const READONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'fd', 'tree', 'stat', 'file', 'pwd',
  'which', 'type', 'echo', 'printf', 'sort', 'uniq', 'cut', 'date', 'whoami', 'id',
  'env', 'printenv', 'less', 'more', 'column', 'jq',
]);

const GIT_READONLY_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'ls-files', 'grep',
  'blame', 'describe', 'shortlog', 'cat-file', 'whatchanged', 'diff-tree',
]);

const FIND_WRITE_FLAGS = ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fls'];

/** 剥离单/双引号内容（用于元字符检测；引号内的操作符不算 shell 操作符） */
function stripQuoted(s: string): string {
  return s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

function gitSubcommand(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-C' || t === '-c' || t === '--git-dir' || t === '--work-tree') {
      i++;
      continue;
    }
    if (t === '--no-pager' || t === '-P') continue;
    if (t.startsWith('-')) continue;
    return t;
  }
  return null;
}

export function isReadonlyBashCommand(cmd: string): boolean {
  const raw = String(cmd ?? '').trim();
  if (!raw) return false;

  const unquoted = stripQuoted(raw);
  if (/[;&|<>`\n\r]/.test(unquoted)) return false;
  if (/\$\(|\$\{/.test(raw)) return false;

  const tokens = unquoted.split(/\s+/).filter(Boolean);
  const head = tokens[0];
  if (!head) return false;

  if (head === 'git') {
    const sub = gitSubcommand(tokens);
    return sub !== null && GIT_READONLY_SUBCOMMANDS.has(sub);
  }
  if (head === 'node') return tokens[1] === '--version';
  if (head === 'npm') return tokens[1] === 'ls' || tokens[1] === 'list';
  if (head === 'tsc') return tokens.includes('--noEmit');

  if (!READONLY_COMMANDS.has(head)) return false;

  if (head === 'find' && tokens.some((t) => FIND_WRITE_FLAGS.includes(t))) return false;
  if (head === 'sort' && tokens.some((t) => t === '-o' || t === '--output' || t.startsWith('--output='))) return false;
  if (head === 'date' && tokens.some((t) => t === '-s' || t === '--set' || t.startsWith('--set='))) return false;
  return true;
}
