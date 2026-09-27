/**
 * 计划模式 bash 白名单（迁移自 pi-tools agent/extensions/plan-mode/utils.ts）
 *
 * 设计：计划模式不整体禁用 bash，而是只放行只读命令（DESTRUCTIVE_PATTERNS 拦截
 * 破坏性命令，SAFE_PATTERNS 必须命中）。原项目 CHANGELOG 记录过三处绕过
 * （find -delete / sed w / curl --output=）已由 DESTRUCTIVE_PATTERNS 覆盖。
 *
 * 纯逻辑，零 Pi 依赖。
 */
const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)/i,
  // git 写引用/配置类（审计 MEDIUM）：branch 新建、remote 写子命令、show/diff/log --output 落盘
  // --ext-diff/--textconv 显式 flag 由恶意仓库配置驱动任意执行（审计 MEDIUM；textconv 默认开启的
  // 配置驱动风险需仓库信任层管理，此处拦显式 flag fail-closed）
  /\bgit\b[^\n;|&]*\s--(no-)?(ext-diff|textconv)\b/i,
  // branch 删除/改名/拷贝等 - 开头写操作由 SAFE 白名单枚举拦截（见下方 branch 只读参数集）
  /\bgit\s+branch\s+[^-\s]/i,
  /\bgit\s+remote\s+(add|rename|set-url|remove|prune|update)/i,
  /\bgit\s+(show|diff|log)\b[^\n;|&]*--output/i,
  // find 的破坏性动作：-delete 删除、-exec/-ok 系列执行、-fls/-fprint/-fprint0/-fprintf 写文件。
  // 审计同类缺口：尾部 \b 使 -fprint0 漏拦（t 与 0 均为词字符无边界）——去尾 \b 改前缀匹配（fail-closed），
  // 同时补齐 -execdir/-okdir 执行变体与 -fls 写文件变体
  /\bfind\b[^\n;|&]*\s(-delete|-exec(dir)?|-ok(dir)?|-fls|-fprint0?|-fprintf)/i,
  // less/more 启动命令 +cmd/+!cmd 可执行任意 shell（非 LESSSECURE 环境；审计同类缺口）
  /\b(less|more)\b[^\n;|&]*\s\+\S/i,
  // bat --pager=<cmd> 任意进程执行（同 rg --pre 类；审计同类缺口）
  /\bbat\b[^\n;|&]*\s--pager(\s|=)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  // curl/wget 落盘即破坏（curl -o/-O/--output=/--output 写文件、wget 非 -O - 时写文件）
  /\bcurl\b[^\n;|&]*\s(-o\s|-o\S|--output\s|--output=|-O\s|--remote-name)/i,
  /\bwget\b(?!\s+-O\s*-)/i,
  // date 改系统时钟（审计 LOW：root 下影响缓存 TTL/调度）
  /\bdate\s+(-[^\s]*s|--set)/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  // sed w 命令写文件：地址+[0-9,$,/]w file 或独立 w file（GNU sed 仅 -n 只读放行）
  // 审计 MEDIUM：flags 含字母组合（gw/pw/Iw…）时 w 前是词字符致 \bw 失效——字符类扩入 a-z
  /\bsed\b[^\n;|&]*([0-9,$/a-z]*w\s|\bw\s)\S/i,
  // sed 执行类（审计 HIGH）：e 命令执行 shell（GNU sed -n 不抑制 e）；s///e flag 将 replacement 作 shell 命令执行
  /\bsed\b[^\n;|&]*([0-9,$/}]+e\s|\be\s)\S/i,
  /\bsed\b[^\n;|&]*s[/|,#][^'"\n]*[/|,#][^'"\n]*[/|,#][a-z,]*e[a-z,]*/i,
  // rg --pre 执行预处理命令（任意进程执行；审计 HIGH：白名单含 rg 但未拦执行类 flag）
  /\brg\b[^\n;|&]*\s(--pre|--pre-glob)(\s|=)/i,
  // fd -x/-X/--exec/--exec-batch 对每个结果执行命令（任意进程执行，同上）
  /\bfd\b[^\n;|&]*\s(-x|-X|--exec|--exec-batch)(\s|=)/i,
  // tree --infofile <f> 可落盘写文件
  /\btree\b[^\n;|&]*\s--infofile(\s|=)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*lsblk\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|config\s+--get)/i,
  // branch 仅放行只读参数集（审计 HIGH：裸放行使 git branch -D/-m/--force 绕过删改分支）
  /^\s*git\s+branch(\s+(-a|-r|-v|-vv|--all|--list(\s+\S+)?|--show-current|--contains\s+\S+|--no-contains\s+\S+|--merged(\s+\S+)?|--no-merged(\s+\S+)?))*\s*$/i,
  // remote 仅放行只读子命令（prune/update 会按配置清理本地跟踪引用，不在此列）
  /^\s*git\s+remote(\s+-v|\s+--verbose|\s+show\s+\S+|\s+get-url\s+\S+)*\s*$/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
  /^\s*wget\s+-O\s*-/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

/** 只读管道右侧允许的切片命令（无写文件能力；sed -w/sort -o 等一律不放行） */
const PIPE_TAIL_RE = /^\s*(head|tail|less|more|wc|uniq|cat|grep)\b([ \t].*)?$/;

/** 单条只读段判定：无分隔符/命令替换/换行/重定向，且命中白名单、不命中破坏性。 */
function isReadOnlyCmd(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // 单条：无 ; && | <(进程替换) >写 `< >( 重定向) 或 反引号/$() 或 换行
  if (/[;&|<>]|`|\$\(|\n|\r/.test(t)) return false;
  return !DESTRUCTIVE_PATTERNS.some((p) => p.test(t)) && SAFE_PATTERNS.some((p) => p.test(t));
}

/**
 * 规划模式 bash 只读校验。
 * 借鉴 opencode 的"模式只是提示词、机制要可预期"思路，放宽高频误拦：
 *  1. `cd <目录> && <单条白名单命令>` 前缀（模型习惯性打包导航）
 *  2. 命令尾部 `2>/dev/null`（丢弃 stderr，非落盘）
 *  3. 单一只读管道：`<只读命令> | <无写切片>`（如 curl GET URL | head，右侧限无写能力）
 * 其余复合（`;`、多管道、`&&` 多重、命令替换、重定向到文件、写落盘切片）一律拒绝。
 */
export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // 尾部 2>/dev/null：允许且仅允许这一种重定向形态
  const withStderrDiscard = /\s*2\s*>\s*\/dev\/null\s*$/.test(trimmed);
  const core0 = withStderrDiscard ? trimmed.replace(/\s*2\s*>\s*\/dev\/null\s*$/, "").trimEnd() : trimmed;
  if (!withStderrDiscard) {
    // 未剥离的其它重定向一律拒绝（> / >> / 2> 非 /dev/null / 2>&1 等）
    if (/>|>>/.test(core0)) return false;
  }
  // 剥离后不得再出现重定向（如 `ls 2>/dev/null > out`）
  if (withStderrDiscard && />|>>/.test(core0)) return false;

  // cd 前缀：cd <dir> && <核心命令>（核心命令仍须整体单条白名单）
  // 审计 HIGH：cd 参数先剥离后检查，参数内命令替换（$(touch)/`touch`/"$(… )"）逃过 $()/反引号
  // 检查被 shell 真实执行——剥离前先对 cd 参数本体做分隔符/替换扫描
  const cdMatch = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/.exec(core0);
  if (cdMatch && /[;&|&]|`|\$\(|\n|\r|<\(/.test(cdMatch[1])) return false;
  const core = /* cd 前缀剥离 */ cdMatch ? core0.slice(cdMatch[0].length).trim() : core0;
  if (cdMatch && core.includes("&&")) return false;

  // 单一只读管道特判：<只读单命令> | <无写切片>（左右各自单条、无写、无分隔）
  // 其余管道形态落入下面的分隔符拒绝
  const pipeIdx = core.indexOf("|");
  const singlePipe = pipeIdx >= 0 && !core.includes("|", pipeIdx + 1);
  let readOnlyPipe = false;
  if (singlePipe) {
    const lhs = core.slice(0, pipeIdx);
    const rhs = core.slice(pipeIdx + 1);
    // 审计 HIGH：RHS 仅匹配 PIPE_TAIL_RE 时尾参任意——`ls | grep $(bash x)` 命中 grep
    // 且无 > 即放行并跳过分隔符拒绝。RHS 追加 isReadOnlyCmd 全量检查（拒 $()/反引号/
    // 分号/换行），PIPE_TAIL_RE 保留为"右侧限无写切片命令"的语义约束。
    readOnlyPipe = isReadOnlyCmd(lhs) && PIPE_TAIL_RE.test(rhs.trim()) && isReadOnlyCmd(rhs);
  }
  if (!readOnlyPipe) {
    // 核心不得出现分隔符/命令替换（管道、分号、多个 &&、反引号、$()、换行）
    // 换行注入（审计实测）：'ls\nbash /tmp/x.sh' 以白名单命令开头时整串放行，
    // 换行后的第二条命令不受任何白名单约束
    if (/[;&|&]|`|\$\(|\n|\r/.test(core)) return false;
  }

  // awk 白名单存在任意执行/读文件形态（审计实测 system(...) 放行）——
  // 收紧：禁止 system/getline（含无括号语句形态）与重定向
  if (/^\s*awk\b/i.test(core) && /\b(system|getline)\b|>\s*\S/.test(core)) return false;

  // curl 白名单存在外传形态（审计实测 -T/--upload-file、-d @file、-F file=@ 均放行；
  // 审计 MEDIUM：--data-urlencode/--data-raw/--data-json/--data-ascii 此前漏拦——
  // --data 前缀后跟 `-` 不匹配 (\s|=) 锚定）——收紧为 GET-only 查询；
  // 审计 MEDIUM 同类：URL 内裸 $VAR 经 shell 展开可将环境秘密拼入查询串外带（$() 已被
  // 分隔符拒绝，剩余裸 $ 即变量展开）——curl/wget GET 段一律禁 $
  // 审计 MEDIUM：-K/--config（配置文件内 output=/data=@file 绕过命令行拦截）与独立 --json
  // （curl≥7.76 @file 读文件 POST）补拦；wget -O - 形态的 --post-file/--post-data/--method
  // 可读文件外带（wget DESTRUCTIVE 已拦非 -O - 形态，此处补 -O - 形态的外传 flag）
  if (/^\s*curl\b/i.test(core) && /(^|\s)(-T|--upload-file|--data(?:-urlencode|-raw|-json|-ascii)?|--data-binary|-d|--form|-F|-K|--config|--json)(\s|=)/.test(core)) return false;
  if (/^\s*wget\b/i.test(core) && /(^|\s)(--post-file|--post-data|--body-file|--body-string|--method)(\s|=)/.test(core)) return false;
  if (/^\s*(curl|wget)\b/i.test(core) && /\$/.test(core)) return false;

  // 进程替换 <(...)（审计实测：`diff <(python3 -c '写文件') <(echo x)` 曾放行——
  // 核心分隔符检查只拦 $()/反引号，< 不在列；>( 已被重定向拦截，<( 是唯一漏网入口）
  if (/<\(/.test(core)) return false;

  // sort -o/--output 可写文件（审计实测：sort 在白名单且 DESTRUCTIVE 无 -o 拦截）；
  // --compress-program=CMD 对排序块执行任意程序（审计 MEDIUM：引号内空格不含分隔符即放行）
  if (/^\s*sort\b/i.test(core) && /(^|\s)(-o|--output|--compress-program)(\s|=)/.test(core)) return false;

  return !DESTRUCTIVE_PATTERNS.some((p) => p.test(core)) && SAFE_PATTERNS.some((p) => p.test(core))
}
