# 先用实验判别，再动（可能不该动的）代码

面向"**改不改**"这类判断：某个时序修法是否真的生效？某段代码是否真的在跑？某项优化值不值得动
`vendor/pi` 关键路径？本文把 2026-10-07 一天里四次判断的做法固化成可复用的配方。

## 1. 为什么需要它（三条真实翻车）

| 结论 | 当时的依据 | 实验/数据给出的真相 |
|---|---|---|
| "重启续跑丢回复是因为在 `session_start` 里跑在未换绑的会话上" | 读 vendor 的会话替换顺序，看着很合理 | 重启是**新进程 + `--session`**，根本不走会话替换（`main.ts` 不调用 `finishSessionReplacement`）→ 归因错 |
| "那就加一个换绑完成事件，别猜延时" | 事件在 `finishSessionReplacement` 末尾发，语义正确 | 该事件在重启路径**永不触发** → `PI_RESTART_RESUME_DELAY_MS=120000` 时场景 **2/33**（续跑没发生），证明起作用的一直是延时 |
| "那就排队优先（`deliverAs`），不必等空闲" | 排队语义天然安全 | `followUp`/`steer`/`nextTurn` **都不会起回合** → 不能拿来唤醒 |

三次都是"读代码 + 合理推理"得出的错误结论。**代码顺序对，不等于运行时会那样走。**

## 2. 三条原则

1. **先定判别性指标**：这个指标必须能区分"改前/改后"，而且**不会因为宽容而假绿**。
   反例：`test-scenario-mode-restart.mjs` 的"回复未落盘"只是**软警告**——`0ms` 与 `600ms` 跑出来都
   33/33，用它根本判别不了。
2. **掐掉兜底再测**：实现里通常带着兜底路径（定时器、fallback、重试）。要证明"新路径真的在起作用"，
   就把兜底弄到不可能在测试窗口内生效（例：延时设 120s），再看还通不通。
3. **能用真实数据就别用估计**：频率、规模、收益这类量，先从 `portable/memory/**` 的日志里数出来
   （例：G3 的"压缩几乎不发生"= `auto-compact` 事件全量 2 次、指纹里压缩归因 0 次）。

## 3. 三档实验台（按成本选）

| 档 | 形态 | 单次成本 | 适合判断 |
|---|---|---|---|
| **A 真实数据取证** | 直接 grep/聚合 `portable/memory/**` 的台账与日志 | 秒级、零风险 | 频率、规模、收益、是否真在跑 |
| **B 无头生命周期** | `--print` + 假 provider + 临时扩展按相位注入 | ~45s（本次主力） | 相位/时序/API 语义、payload 形状 |
| **C 真实 pty 场景** | `scripts/test-scenario-mode-restart.mjs`、`test-scenario-two-instances.mjs` | 4–8 分钟 | 端到端生命周期、跨进程/多实例 |

判断取舍：**先 A，再 B，最后才 C**。C 的问题不是慢，而是它的软检查会让你得出假绿。

## 4. B 档配方（自包含，可 5 分钟重建）

一次性脚本放 `/tmp`（**不入库**：它是实验，不是守门）。四件东西：

```js
// 1) 隔离 agent 目录：拷 settings/auth/modes/persona，写自己的会话头
const AGENT = join(T, 'agent');
mkdirSync(join(AGENT, 'sessions', '--root-my-pi--'), { recursive: true });
for (const f of ['settings.json','auth.json','keybindings.json','trust.json','modes.json','APPEND_SYSTEM.md','AGENTS.md'])
  copyFileSync(join(ROOT, 'portable/agent', f), join(AGENT, f));
const SESS = join(AGENT, 'sessions', '--root-my-pi--', 'exp.jsonl');
writeFileSync(SESS, JSON.stringify({ type:'session', version:3, id:'<uuid>', timestamp:new Date().toISOString(), cwd: ROOT }) + '\n');

// 2) 假 provider（仓库自带）：把 models.json 指向它，并把 defaultProvider/Model 改过去
const provider = await startFakeProvider({ replyText: 'EXP-REPLY-OK', delayMs: 50 });   // scripts/lib-fake-provider.mjs
// providers.scenario = { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: 'openai-completions', apiKey: 'exp',
//   models: [{ id:'scenario-model', reasoning:false, compat:{ supportsDeveloperRole:false, supportsReasoningEffort:false } }] }

// 3) 临时扩展：默认导出必须是函数；相位/参数用环境变量传，便于一个脚本扫多组
//    export default function (pi) { const phase = process.env.EXP_PHASE; pi.on(phase, () => { ... pi.sendMessage(msg, opts) ... }); }

// 4) 跑 + 量：spawn（不是 spawnSync！）+ 解析会话 jsonl
const r = await new Promise((resolve) => {
  const c = spawn('node', [CLI, '--print', '--session', SESS, '--extension', EXT, 'hi'],
    { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });   // stdin 必须 /dev/null
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const to = setTimeout(() => c.kill('SIGTERM'), 120_000);
  c.on('close', (code) => { clearTimeout(to); resolve({ status: code, stdout: out, stderr: err }); });
});
// 指标：会话里 type==='message' 的 role 计数（assistant/user）、custom_message 计数、rc、stderr 关键行
```

### 两个必踩的坑（各踩过一次，共浪费 ~10 分钟）

1. **假 provider 跑在实验脚本进程内时，绝不能用 `spawnSync`**：它会阻塞事件循环 → provider 永远不响应
   被 spawn 的 pi → 表现为"pi 挂到超时、stdout 空、assistant=0"。必须 `spawn` + await close。
2. **`--print` 模式会先 `readPipedStdin()`**：不把子进程 stdin 设成 `/dev/null`
   （`stdio: ['ignore','pipe','pipe']`）就会一直等 stdin，永远不开始跑。

### 经验参数

- pi 冷启动在本机是 **35–45s**（双实例并发时 55–73s）：等待/超时给足，别把慢当成失败。
- `process.title = 'pi'` 会让 `/proc/<pid>/cmdline` 只剩 `pi`：认进程要用 `/proc/<pid>/exe` +
  `/proc/<pid>/environ`（并排除 `node -e` 助手）。
- 已实测的注入语义（可直接引用）：`triggerTurn` **只在 agent 空闲时合法**（忙碌时 pi 报
  `Agent is already processing…`、进程 rc=1、**catch 不住**）；`deliverAs` 的
  `followUp`/`steer`/`nextTurn` **都不会起回合**；`agent_settled` 那一刻空闲、`triggerTurn` 可用。

## 5. 收尾纪律（结论要能被下一个人复核）

- **负结果也要入库**：证伪的修法写进 `DECISIONS.md`（含判别命令与数字），把结论作为注释留在改动过的
  代码旁边——下一个维护者一定先看那里。回退要彻底（补丁/消费端/测试一起退，别留死代码）。
- **写"复核命令 + 触发条件"**：不要只写"暂不做"，要写"什么条件下做、届时怎么验证"（例：G3 的
  `grep -c '"type":"auto-compact"' …` + "一周内 ≥1 次就动手"）。
- **区分"守门"与"实验"**：判据稳定、便宜、可重复的才升级成 `scripts/` 里的守门；一次性的判别实验
  留在 `/tmp`，做法写进文档（本文）。
