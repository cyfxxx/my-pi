# DSH Context-Management Audit

Read-only audit of the installed DeepSeek Harness (DSH) bundles at
`/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/` (version line `0.1.5-rc.2`).
No file under `@deepseek-ai/` was modified.

**Evidence labels**
- **[CODE]** — exact literal/quote from a bundled `lib/*.js` or `lib/types/*.d.ts`.
- **[YAML]** — the effective runtime composition (`cordis.patch.yml`, preset `agent.cordis.yml`).
- **[README]** — a documentation claim only.
- **[INFERENCE]** — my reasoning; not asserted by the code.

---

## 0. Executive answers (the five specific questions)

### Q1. Does DSH compact automatically, and at what threshold relative to the model context window?

**Yes, automatic compaction is enabled by default — but the threshold is 80% of an
adapter-declared window that is 1,000,000 tokens on the default DeepSeek route, i.e.
800,000 tokens.** That is why a 130-request / 285K-token session showed no context drop.

- **[CODE]** `dsh-compaction-basic/lib/index.js:15` `const DEFAULT_THRESHOLD_RATIO = .8;`
- **[CODE]** `dsh-compaction-basic/lib/index.js:17` `const DEFAULT_RETAIN_RATIO = .16;`
- **[CODE]** `dsh-compaction-basic/lib/index.js:76` `auto: config.auto ?? true`
- **[CODE]** `dsh-compaction-basic/lib/index.js:111-112`
  `const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);`
  `const retainTokens = policy.retainTokens === void 0 ? Math.floor(contextWindow * policy.retainRatio) : policy.retainTokens;`
- **[CODE]** `dsh-compaction-basic/lib/index.js:895` the window is fetched per request:
  `const context = (await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context;`
- **[CODE]** `dsh-llm-deepseek/lib/index.js:1392` `const DEFAULT_CONTEXT_WINDOW = 1e6;` and every catalog
  model (`deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`) is
  constructed with `contextWindow: DEFAULT_CONTEXT_WINDOW` (`:1845-1866`).
- **[YAML]** `dsh-base/cordis.patch.yml:75-79` default route is `provider: deepseek-official`,
  `model: deepseek-flash`.

**⇒ Threshold on the default route = `floor(1_000_000 × 0.8)` = 800,000 tokens; retained tail =
`floor(1_000_000 × 0.16)` = 160,000 tokens.** 285K is ~36% of the window: far below the trigger.
No YAML anywhere overrides `thresholdRatio`/`retainRatio` (grep over all `*.yml`/`*.yaml` finds none).

Caveat for a different route: the pi-ai adapter's assumed capacity is
**[CODE]** `dsh-llm-pi-ai/lib/index.js:893` `const DEFAULT_CONTEXT_WINDOW = 262144;` → threshold
209,715. On such a route 285K *would* exceed the threshold, so the observation is only consistent
with the `deepseek-official` (1e6) route. **[INFERENCE]** unless `measure()` returned `null` range or
the displayed 285K was a cumulative (not occupancy) figure — see §4.1.

### Q2. How are large tool outputs bounded before entering context?

A four-layer ladder; the layer that fires depends on size and on whether a compaction trigger
qualifies:

| Layer | Trigger | Effect | Recoverable? |
|---|---|---|---|
| Per-tool caps (`read`, `bash`, PTY) | always | head/tail window | yes, for `read` via `offset`; yes, for one-shot `bash` via spill path |
| `spill-policy` (`tools/post-execute`) | final text > **50,000 bytes** | head+tail preview + **file path** | **yes**, model `read`s the spill file |
| `tool-result-pruner` | *only after a compaction trigger*, any surface `tool/result` > **8,192 code points** | head 4,096 + marker + tail 1,024 | **no file** — original only in the append-only log |
| `compaction-basic` | total ≥ **800K** tokens (default route) or provider context-overflow error | whole span → one summary user message | no (summary only) |

Exact strings: `"[... tool result middle pruned ...]"` and
`" Full formatted result stored at: "`, `"Use read with offset/limit, or grep this path to search within it."`

### Q3. Is there per-request usage/cache accounting persisted or displayed?

**Yes — durable, per model step, with explicit cache buckets, but no monetary cost anywhere.**

- **[CODE]** `dsh-llm/lib/types/types.d.ts:131-150` — `TokenUsage { inputTokens, outputTokens,
  totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`, and the counts are
  **disjoint**: "`inputTokens` is uncached input only; cached input is reported separately as
  `cacheReadTokens`/`cacheWriteTokens`".
- **[CODE]** `dsh-session/lib/types/types.d.ts:309-317` — `assistant/message` carries
  `usage?: TokenUsage`: "Carries the step's `usage` … so the model output and its accounting travel
  together (there is no separate usage record)."
- **[CODE]** `dsh-llm-deepseek/lib/index.js:1154-1166` `mapUsage` converts DeepSeek wire usage
  (`prompt_tokens` includes cache hits) into disjoint counts:
  `inputTokens: usage.prompt_tokens - (cacheRead ?? 0)`, `cacheReadTokens: cacheRead`,
  and reads `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`.
- **[CODE]** the JSONL writer persists the event body verbatim:
  `dsh-session-persistence-jsonl/lib/index.js:953-955` `JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))`;
  `usage` is an admitted optional field of the released format
  (`dsh-session-format-v1-to-v2/lib/index.js:13-20`).
- **Displayed**: projections `tokenUsage {uncachedInputTokens, outputTokens, cacheReadTokens,
  cacheWriteTokens}` and `contextPressure {pressureTokens?, projectedTokens?, contextWindow?}`
  ([CODE] `dsh-token-meter/lib/types/projection.d.ts`), registered on `ctx.sessionProjections`
  (`dsh-token-meter/lib/index.js:615-617`).
- **No cost/`usd`/price field exists** in any session/LLM package. [INFERENCE] dollar figures are
  computed outside these packages.
- **`prompt_cache_miss_tokens` is parsed on the wire but not mapped** — it is implicitly
  `inputTokens`. `cacheWriteTokens` has no DeepSeek wire source (it exists for Anthropic-style
  cache-write billing via pi-ai).

### Q4. System-prompt / instruction-injection strategy w.r.t. prompt caching

The system prompt is **placed in history as surface node 0** (a `system/message` event), never sent
as a request `system` field, and a changed prompt on a capable route is **appended after the cached
history** rather than rewriting message 0.

- **[CODE]** `dsh-agent-loop/lib/index.js:1204-1217` `const boundaryMessages = session.deriveMessages(); … messages: boundaryMessages`.
- **[CODE]** `dsh-llm/lib/types/types.d.ts:315-319`:
  `'in-history'`: "the model reads the latest `system` message at any position of `messages` as the
  complete effective system prompt, so a changed prompt can follow the cached history instead of
  rewriting message 0."
- **[CODE]** `dsh-llm-deepseek/lib/index.js:1849` the `deepseek-flash` catalog entry declares
  `systemPromptUpdate: "in-history"`.
- **[CODE]** `dsh-agent-loop/lib/index.js:266-284` `SystemPromptProjection.project`:
  `if (!input.inHistory || input.startsSeries || rendered.length === 0) { …replace head… }`
  else `if (latest.text === rendered) return []; return [{ message: createSystemMessage(rendered, SOURCE), intent: { surfaceOp: "append" } }];`
- Volatile content is deliberately kept **out** of the system prompt: dynamic state is assembled
  separately as a `user/message` snapshot, re-emitted only when changed
  (`RuntimeContextProjection.project`, `dsh-agent-loop/lib/index.js:336-339`:
  `if (this.retained?.text === snapshot) return;`).
- **[YAML]/[CODE]** plan mode keeps the tool catalog unchanged "for request-cache stability"
  (`dsh-base/cordis.patch.yml:309`).

### Q5. Explicit prompt-cache-aware behaviour

- Summary calls replay the conversation prefix so the auxiliary call reuses the provider KV cache:
  **[CODE]** `dsh-compaction-basic/lib/index.js:214-218` — the compaction instruction is appended as
  the FINAL user message "rather than as a distinct summarizer system prompt. Keeping the
  conversation's own system prompt, tools, and message prefix in front of it makes the auxiliary call
  a genuine prefix of the last routed request, so the provider's KV cache is reused instead of
  invalidated."
- Fork subagents inherit parent history specifically for KV-cache reuse:
  **[YAML]** `dsh-agent-presets/presets/standard/agent.cordis.yml:189-192` — "Fork omits model
  selection so provider/model stay equal to the parent and the inherited history remains eligible
  for KV Cache reuse."
- Provider-level cache directives are passed through, not implemented: **[CODE]**
  `dsh-llm-pi-ai/lib/index.js:331` `const CACHE_CONTROL_FORMATS = Object.keys({ anthropic: true });`
  plus compat flags `cacheControlFormat`, `supportsLongCacheRetention`, `supportsCacheControlOnTools`
  (`:948-952`). **No cache-TTL logic, no explicit `cache_control` breakpoint placement, and no TTL
  refresh policy exist in DSH itself** — they are pi-ai library/provider concerns. [INFERENCE]

---

## 1. Where the mechanisms are wired (effective configuration)

**[YAML]** `dsh-base/cordis.patch.yml` mounts the host-plane rows; `dsh-web-app/cordis.patch.yml:427-434`
disables `compaction-basic`, `command-compact`, `tool-result-pruner` there, and the agent presets
re-mount them per preset. The effective numbers therefore come from the preset (identical to base):

```
dsh-agent-presets/presets/standard/agent.cordis.yml:138-156
- id: compaction
  name: cordis:group
  isolate: { compaction: true, toolResultPruner: true }
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'          # no config → code defaults
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

Other effective rows:

| Row | Config | File |
|---|---|---|
| `agent-instructions` | `maxBytes: 65536` | `dsh-base/cordis.patch.yml:268-271`; `presets/standard/agent.cordis.yml:31-34` |
| `spill-policy` | `maxInlineBytes: 50000` | `dsh-base/cordis.patch.yml:383-386` |
| `agent-default-model` | `provider: deepseek-official`, `model: deepseek-flash` | `dsh-base/cordis.patch.yml:75-79` |
| `tool-subagent` | `provider: spawn`, `toolName: subagent`, `backgroundMode: continuable` | `presets/standard/agent.cordis.yml:181-187` |
| `tool-subagent-fork` | `provider: fork`, `toolName: subagent_fork` (no model selection) | `presets/standard/agent.cordis.yml:193-198` |
| `token-meter` | host-plane, no config | `dsh-base/cordis.patch.yml:317-318` |

---

## 2. Mechanism: `dsh-compaction` (the seam)

**[CODE]** `dsh-compaction/package.json` — "Abstract compaction service seam (`ctx.compaction`)".
It carries **no thresholds and no `shouldCompact`**:

- **[CODE]** `lib/index.d.ts:19` `export type CompactionTrigger = 'pressure' | 'context-overflow';`
- **[CODE]** `lib/index.d.ts:21` `export type ManualCompactionErrorCode = 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence';`
- **[CODE]** three abstract ops: `compactIfNeeded(agent, trigger, signal)`, `compactNow(agent, signal,
  sourceCommandId?)`, `compactRegion(start, end, agent, signal?)`.
- **[CODE]** checkpoint marker `lib/index.js:109-112` `{ kind: "plugin", plugin: "compact" }` +
  `compactCheckpointSource` / `isCompactCheckpointSource`.
- **[CODE]** tool-pair safety: `toolPairingBalancedBefore(session, seq)` / `...After(...)`, balance
  cache keyed by `surface.replaceGeneration` (`lib/index.js:20-55`). Compaction can never split an
  assistant tool-call from its result.
- **[CODE]** events declared on `SessionEventMap` (`lib/types/types.d.ts`): `compaction/start`,
  `compaction/summary` (carries `summary`, `shadowedRange`, `shadowedSeqs`, `shadowedTokenCount`,
  `provider`, `model`, `maxTokens?`, `usage?`), `compaction/end`, `compaction/prune`. These are
  **log-only** (not surface) except that the following `user/message` performs the replacement.
- An **invariant companion** (`lib/invariant.js`) validates the `start → summary → end` bracket, the
  turn enclosure, exactly one summary per compaction, and shadowed-span fidelity.

**[INFERENCE]** `dsh-compaction` is a policy seam; every number lives in the backend.

---

## 3. Mechanism: `dsh-compaction-basic` (the budget manager)

### 3.1 Constants and trigger arithmetic

| Constant | Value | Evidence |
|---|---|---|
| `DEFAULT_THRESHOLD_RATIO` | `0.8` | `lib/index.js:15` |
| `DEFAULT_RETAIN_RATIO` | `0.16` | `lib/index.js:17` |
| `maxTokens` (summary generation cap) | `8192` | `lib/index.js:72` |
| `compactionRetries` | `1` | `lib/index.js:73` |
| `maxOverflowRetries` | `1` | `lib/index.js:74` |
| `auto` | `true` | `lib/index.js:76` |
| `retainRatio` ↔ `retainTokens` | mutually exclusive | `lib/index.js:169` |
| `retainRatio >= thresholdRatio` | load-time throw | `lib/index.js:135` |

**[CODE]** `lib/index.js:108-126` scales ratios by the adapter-owned window:
```js
const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);
const retainTokens = policy.retainTokens === void 0 ? Math.floor(contextWindow * policy.retainRatio) : policy.retainTokens;
if (retainTokens >= thresholdTokens) throw new TargetPressureConfigError(...);
```
**[CODE]** there is **no reserved-output-token constant and no safety-margin constant** in any of
these packages; the only headroom is the 20% gap plus `maxTokens: 8192`. [INFERENCE] the 20% gap is
the de-facto completion reserve.

### 3.2 Automatic triggers

**[CODE]** `lib/index.js:783-787` — `if (this.config.auto) this._registerAutomaticCompaction();`

Two automatic arms, both registered together:

1. **Step-boundary pressure** — `lib/index.js:798-811`
   `ctx.on("agent/pre-step", async ({ agent, signal }, next) => { … const result = await this.compactIfNeeded(agent, "pressure", signal); … })`.
   Body (`lib/index.js:895-919`): resolve window → `if (measurement.totalTokens < spec.thresholdTokens) return null;`
   → optional prune → re-check → loop `attempt <= spec.compactionRetries`.
2. **Provider-confirmed context overflow** — `lib/index.js:820-846`
   `ctx.on("agent/request-error", …)` gated on `failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE`.
   Overflow **bypasses** both the threshold and the retained-tail policy
   (`lib/index.js:891` `selectCompactableRange(agent.session, measurement, 0)`), prunes first, and
   authorizes at most `maxOverflowRetries` retries; retry counters reset on idle and on a landed
   `assistant/message` (`:813-818`).

### 3.3 What is kept and what is dropped

**[CODE]** `selectCompactableRange` (`lib/index.js:393-416`):
- A `system/message` at surface node 0 **is never compacted** (`const firstIdx = systemHead(session, surfaceNodes[0]) === void 0 ? 0 : 1;`).
- The tail is accumulated newest-first until `accumulated >= retainTokens`, then the keep boundary is
  snapped **backwards** while `!toolPairingBalancedBefore(...)`.
- Range = `[surfaceNodes[firstIdx], surfaceNodes[keepFromIdx - 1]]`; `null` when nothing safe remains.
- **[CODE]** `lib/index.js:397` refuses if the token meter's surface disagrees
  (`"compaction: token-meter surface does not match the current session surface"`).

### 3.4 What the model sees afterwards

**[CODE]** the range is replaced by **exactly one** `user/message` (`lib/index.js:621-632`) with
`surfaceOp: { op: "replace", startSeq, endSeq }` and `sourceEventSeqs: [start, summary, ...shadowed]`.
Content is:

- `SUMMARY_OPEN_TAG = "<compacted-summary>"` / `SUMMARY_CLOSE_TAG = "</compacted-summary>"` (`:211-212`)
- `CHECKPOINT_PREAMBLE` (`:257`) =
  *"This is an automatically generated checkpoint condensing an earlier span of the conversation to
  free up context. Treat the captured context as established background and build on it without
  restating it. Continue the task directly from the messages that follow, without acknowledging this
  checkpoint."*
- `frameSummary` (`:323-335`) = preamble + `"\n\n"` + open tag + summary text blocks + close tag.

Failure modes are fail-closed: image output → `LlmError("UNSUPPORTED_CONTENT")` (`:355`); empty
summary → error (`:307`); truncated summary → error code `MAX_TOKENS` (`:345-348`); and a
**strict shrink gate** (`:572`):
`if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) throw new Error('summary is not smaller than the shadowed content ...')`.

### 3.5 Summary generation

**[CODE]** `summarizeWithLlm` (`lib/index.js:269-317`): target = configured
`{summarizationProvider, summarizationModel}` if non-empty → else the latest `requestHeader().config`
→ else `AgentOptions` pair → else throw. It replays the system head + shadowed-region messages +
`header.tools`, appends `COMPACTION_INSTRUCTION` as the final user message, and calls
`ctx.llm.stream({ …, maxTokens: config.maxTokens, purpose: "compaction", signal })`.

**[CODE]** `COMPACTION_INSTRUCTION` (`lib/index.js:220-255`) is a fixed 8-section Markdown template:
`## Primary Request and Intent`, `## Key Technical Concepts`, `## Files and Code`,
`## Errors and Fixes`, `## Pending Jobs`, `## Current Work`, `## Next Step`,
`## Critical Context`, with rules including
*"Do NOT mention this summarization request or that the context was compacted."* and a merge rule
for a pre-existing `<compacted-summary>` block.

### 3.6 Manual (`/compact`) path

**[CODE]** `compactNow` (`lib/index.js:944-970`): runs inside `agent.runMaintenance`,
selects with retention `0` (`:951`), uses a **standalone** bracket `owner: null`,
`stability: "selected-span"`, and flushes persistence after a successful close (`:957-959`).

---

## 4. Mechanism: `dsh-token-meter` (what the thresholds are measured against)

- **[CODE]** `lib/index.js:16-18` `const CHARS_PER_TOKEN = 4; const BLOCK_OVERHEAD = 4;`
  and `estimate.d.ts` `ROLE_OVERHEAD = 4`. The estimator is **heuristic, not a tokenizer**:
  `Math.ceil(text.length / 4) + BLOCK_OVERHEAD`, tools priced as
  `Math.ceil(JSON.stringify(header.tools).length / 4) + BLOCK_OVERHEAD`.
- **[CODE]** `measure(session)` (`lib/index.js:643-686`) prefers provider usage:
  if the latest successful call's canonical envelope matches and its total is ≥ the route-priced
  anchor, `baseline = { kind: "usage", tokens: usageTokens(usage) }`; otherwise it reprices the whole
  envelope. `totalTokens = Math.max(0, baseline.tokens + surfaceDeltaTokens)`.
- **[CODE]** `usageTokens(usage) = inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) + outputTokens` (`lib/index.js:595-597`).
- **[CODE]** `projection.d.ts` — `contextPressure` is explicitly *not* one atomic observation:
  `pressureTokens` is the newest provider-reported prompt size, `projectedTokens` adds the heuristic
  surface delta, `contextWindow` is the newest capacity. "…the value is a user-facing reference, not
  a billing or gating input."
- `ContextBreakdownProjection` = `{systemTokens, toolsTokens, messageTokens}` and is heuristic only.

### 4.1 Why the observed 285K produced no drop — reconciliation

- On `deepseek-official/deepseek-flash` the window is `1e6`, so the trigger is `800,000` and the
  retained tail is `160,000`. 285K is below trigger. **[CODE + INFERENCE]**
- The displayed figure is most likely `contextPressure.projectedTokens` (provider-anchored prompt
  size plus heuristic delta). Even if the display were the *cumulative* `tokenUsage` total, that is
  not what gates compaction — `measure().totalTokens` is. **[INFERENCE]**
- If the route had been a pi-ai default route (262,144 window → 209,715 trigger) 285K *would* have
  triggered; therefore the observation is only consistent with the 1e6 DeepSeek route (or with a
  range selection returning `null`). **[INFERENCE]**

---

## 5. Mechanism: `dsh-compaction-tool-result-pruner`

- **[CODE]** `lib/index.js:8` `const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";`
  (39 code points).
- **[CODE]** `lib/index.js:10-14`
  `const DEFAULTS = deepFreeze({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 });`
  (the base/preset YAML sets the same numbers explicitly).
- **[CODE]** trigger is strictly greater than the threshold: `:93` `if (totalChars <= this.config.thresholdChars) return null;`
  (8192 untouched, 8193 pruned). Output = first 4096 + marker + last 1024 = 5,159 code points.
- **[CODE]** counting/slicing is by Unicode code point (`:26-27` `Array.from(text).length`), so
  surrogate pairs cannot split.
- **[CODE]** **affected tools: every current-surface `tool/result`, no allow-list** (`:139-146`).
  There is no config key to restrict tools.
- **Recoverability: none in context, and no file.** `:170-180` appends a new `tool/result` with
  `surfaceOp: { op: "replace", startSeq: seq, endSeq: seq }` and `sourceEventSeqs: [seq]`, preceded
  by a `compaction/prune` shadow-price event (`:162-169`). The original is still in the append-only
  log, so replay can recover it, but the model cannot.
- **When:** only invoked from `compaction-basic.compactIfNeeded` after a
  **pressure** or **overflow** trigger (`dsh-compaction-basic/lib/index.js:888` overflow,
  `:902` pressure). It registers no listeners of its own and never self-triggers.
- **Automatic**, not user-invoked; no enable switch.

---

## 6. Mechanism: `dsh-spill-policy` + `dsh-output-retention` (file offload)

- **[CODE]** `dsh-spill-policy/lib/index.js:74` `const Config = z.object({ maxInlineBytes: z.number() });`
  — **[YAML]** configured to `50000` in `dsh-base/cordis.patch.yml:386`.
  **[CODE]** `:103-104` omitted `maxInlineBytes` ⇒ the plugin registers nothing (true no-op).
- **[CODE]** `tools/post-execute` arm (`:155-172`): skip if `decision.kind !== "accept"`,
  `Object.hasOwn(decision, "value")`, `exec.parent !== void 0`, or `exec.name === "read"`.
  If `Buffer.byteLength(text, "utf8") > maxInlineBytes`, the FULL text is saved to
  `ctx.spillStore` (`:137 ref = await spillStore.saveText(save);`) and the model-facing result
  becomes a **head/tail preview** split evenly (`:89-101` `headBytes: Math.ceil(budget/2)`,
  `tailBytes: Math.floor(budget/2)`) plus a notice.
- **[CODE]** notice format (`:5-8, 21-23`):
  `"(" + "Omitted N bytes." + " Full formatted result stored at: " + locator + ". " + retrievalHint + ")"`.
- **[CODE]** locator/retrieval hint (`dsh-spill-local/lib/index.js:564-566`):
  `locator: SpillLocator(saved.path)`, `retrievalHint: "Use read with offset/limit, or grep this path to search within it."`
  ⇒ **large results are recoverable by reading the spill file.**
- **[CODE]** `describeOmitted` (`dsh-output-retention/lib/index.js:261-266`):
  `exact → "Omitted N unit."`, `unknown → "More unit were omitted."`
- **[CODE]** a second arm bounds the durable `tool/ptc-dispatch` log copy of oversized `run_code`
  sub-call results (`:173-185`).
- Best-effort: no session owner / no store / save failure ⇒ original kept, warning logged; a spill
  failure never converts success into `isError`.

---

## 7. Mechanism: `dsh-command-compact` (manual `/compact`)

- **[CODE]** `lib/index.js:7-9` name `"command-compact"`, `inject = ["commands", "compaction"]`,
  `const USAGE = "Usage: /compact (no arguments)";`
- **[CODE]** registered as `name: "compact"` (`:92-96`), description
  `"Compact older conversation history"`. **No aliases.**
- **[CODE]** arguments rejected: `:49` `if (invocation.rawInput.trim().length > 0) return { kind: "error", text: USAGE };`
- **[CODE]** semantics: `:54` `await ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId);`
  — the command itself sends no model request.
- **[CODE]** outcomes: `null` → `"No compactable history yet."` (`:57`); success →
  `` `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).` `` (`:61`);
  the full `busy|cancelled|changed|summary|commit|persistence` texts are at `:18-45`.
- **Manual** and idle-only (the backend runs it under `agent.runMaintenance`).

---

## 8. Mechanism: `dsh-session-checkpoint-policy`

**Not a context/token mechanism.** A "checkpoint" here is a durability flush, not a context snapshot.

- **[CODE]** `lib/index.js:9-16` name `"session-checkpoint-policy"`,
  `inject = ["llm", "sessionPersistence", "sessions", "tools"]`; **no config, no constants, no
  thresholds, always on when mounted.**
- **[CODE]** the checkpoint primitive is `await ctx.sessions.flush(session)` (`:26-31`).
- **[CODE]** three seams (`:60-76`): `llm/stream` (flush the complete logged request prefix before
  adapter dispatch), `tools/execute` (flush the recorded call before the tool body; aborted ⇒
  canonical `"Error: tool call aborted before dispatch"` result), and `agent/pre-step`.
- Fail-closed at the model and tool side-effect boundaries.
- **[CODE]** compaction adds its own optional flush after a successful standalone bracket
  (`dsh-compaction-basic/lib/index.js:957-959`).

---

## 9. Mechanism: `dsh-fs-observation-policy` — **premise correction**

This package does **not** bound file reads or observations, and sets no line/byte limits.

- **[CODE]** `lib/index.js:64-70` `editIntent`:
  `if (!owner || prior === void 0) throw new FsError(\`edit requires reading "${target.displayPath}" first\`, "FS_NOT_OBSERVED");`
  and `if (prior.kind === "absent") throw new FsError(\`cannot edit "${target.displayPath}": not found\`, "FS_NOT_FOUND");`
- **[CODE]** `lib/index.js:51-58` `writeIntent`: unseen/absent ⇒ `{ kind: "createIfAbsent" }`;
  present ⇒ `{ kind: "replaceIfVersion", version: prior.version }`.
- **[CODE]** `lib/index.js:92-94` records observations from `fs/observed`.
- **[CODE]** the actual provider enforcement (`dsh-fs-local/lib/index.js:826-845`):
  `"cannot overwrite existing \"…\" without reading it first"` (`FS_NOT_OBSERVED`) and
  `"cannot edit \"…\": file changed since it was read"` (`FS_STALE_VERSION`).
- **[CODE]** model-facing normalisation (`dsh-tool-fs/lib/index.js:547-548`):
  `` `cannot modify "${displayPath}": file has not been read — read the file, then retry` ``.
- **[README]** `dsh-fs-observation-policy/README.md:129` — "Authorization is version freshness, not
  view completeness — any windowed read authorizes a full-file overwrite of an unchanged file."
- There is **no "claim" precondition anywhere**; the task's "read before claim" appears to be a
  conflation. [INFERENCE]

### 9.1 Where read bounding actually lives: `dsh-tool-fs`

| Cap | Default | Evidence |
|---|---|---|
| Lines per read | `READ_LIMIT = 2e3` (2000; default *and* max) | `lib/index.js:293`, config `:1248` |
| Bytes per read result | `READ_MAX_BYTES = 50 * 1024` (51,200) | `lib/index.js:18`, config `:1250` |
| Characters per line | `READ_MAX_LINE_LENGTH = 2e3` | `lib/index.js:16`, config `:1249` |
| Stream threshold | `STREAM_MIN_SIZE = 10 * 1024 * 1024` | `lib/index.js:298` |

- **[CODE]** args: `offset` defaults to 1, `limit` defaults to the cap, `limit > maxLimit` throws
  (`:309-313`).
- **[CODE]** per-line truncation: `` `${line.substring(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)` `` (`:27-28`).
- **[CODE]** footers (`:103-105`):
  `(Output capped. Showing lines a-b. Use offset=N to continue.)`,
  `(Showing lines a-b of N. Use offset=N to continue.)`, `(End of file - total N lines)`.
- Model-recoverable by paging with `offset`. **Automatic** (tool-layer default).

---

## 10. Mechanism: bash / terminal output bounding

### 10.1 One-shot `bash` (the tool in this session)

- **[CODE]** `dsh-bash-local/lib/index.js:132-133`
  `maxOutputBytes: z.number().default(64e3)` (64,000 bytes **per stream**) and
  `maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES)` where `:88-89`
  `const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;` (64 MiB).
- **[CODE]** direction is **tail** (`dsh-subprocess-local` runner: in-memory tail window, `lossy`
  when the requested offset slid out).
- **[CODE]** model-visible notice (`dsh-tool-bash/lib/index.js:38-42`):
  `` `${output.text}\n[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]` ``.
- **[CODE]** tool description (`:127`): "Long output is truncated to its tail; the full output is
  saved to a file whose path is reported when available." ⇒ **recoverable via `read`.**

### 10.2 Persistent PTY tool

- **[CODE]** `dsh-tool-bash-persistent/lib/index.js:365` `maxOutputChars: z.number().default(16e3)`
  (16,000 chars); `:76-79` head cut + notice.
- **[CODE]** notices: `TRUNCATED_MESSAGE = "<response clipped><NOTE>To save on context only part of
  this file has been shown to you. You should retry this tool after you have searched inside the file
  with \`grep -n\` …</NOTE>"` (`:68`), `LOST_PREFIX_MESSAGE = "<response clipped><NOTE>The beginning
  of this command output was dropped by the terminal scrollback limit. …</NOTE>\n"` (`:69`).
- **[CODE]** paging `SCROLLBACK_PAGE_LINES = 1e3` (`:73`).

### 10.3 `dsh-terminal` / `dsh-terminal-bash`

`dsh-terminal` itself is an owner-scoped PTY registry with **no size constants** (`read()` is a
pass-through, `lib/index.js:185-187`). The bounds are backend-owned:

- **[CODE]** `dsh-terminal-bash/lib/index.js:37-53`
  `rows: 40`, `cols: 160`, `scrollbackLines: 1e4` (10,000), `scrollbackMaxBytes: 4 * 1024 * 1024`
  (4 MiB), `maxReadBytes: 256 * 1024` (262,144 per page); a read page defaults to **500 lines**.
- Overflow drops the oldest lines/bytes (`truncated: true`). **No file offload for the PTY path** —
  once evicted, output is gone. [INFERENCE] the `TRUNCATED_MESSAGE` advice to use `grep -n` is
  inherited from file-read semantics and is a poor fit for command output.

---

## 11. Mechanism: `dsh-agent-instructions`

### Discovery

- **[CODE]** `lib/index.js:17-18`
  `const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];`
  `const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.local.md", "CLAUDE.local.md"];`
- **[CODE]** `:141` `const USER_GLOBAL_FILE = "AGENTS.md";` under `$DSH_HOME` (default `~/.dsh`).
- **[CODE]** `:16` `DEFAULT_PROJECT_ROOT_MARKERS = [".git"]`; root found by walking upward (`:480-488`).
- **[CODE]** discovery order (`:561-579`): user-global first, then `ancestorChain(projectRoot, cwd)`
  (broad → specific), and within each directory base candidates then `.local` overlays; all existing
  candidates load.
- **[CODE]** dedup: path-level (`:555-558`) and **per-directory trimmed-content** (SHA-1 of
  `content.trim()`, `:632-648`) — only same-directory siblings collapse.

### Injection, role, position

- **[CODE]** the payload is a **`user/message`**, not a system section, and is wrapped in
  `<system-reminder>` … `</system-reminder>` (`:111-112`), with literal closing tags escaped in file
  content (`:128-129`).
- **[CODE]** intro (`:113`): *"The following workspace instructions may be relevant to your work. Use
  them as guidance when applicable. More specific instructions take precedence over broader ones.
  They do not override system, developer, or direct user instructions."*
- **[CODE]** section header (`:131`): `` `Instructions from: ${file.displayPath}\n\n${file.content}` ``.
- **[CODE]** position (`:1270-1288`): inserted immediately after the newly claimed user messages in
  the entering batch (`decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)`); queued
  baselines go to the next-step inbox.
- **Stability / caching:** the baseline is appended once and replays from history; a compatible
  baseline identity is not re-emitted (`:1124-1130`), an incompatible one appends a **complete
  replacement** with `REPLACEMENT_WORKSPACE_CONTEXT_INTRO` (`:114`). [README] ":151 The rendered
  baseline is appended once and remains in derived history until compaction." ⇒ append-only and
  cache-friendly.

### Size limits

| Limit | Value | Evidence |
|---|---|---|
| Rendered baseline/delta budget (`maxBytes`) | **65,536 B** (deployment), schema-required, no package default | `dsh-base/cordis.patch.yml:271`; `lib/index.js:28` |
| Per source file (`maxSourceBytes`) | `1048576` (1 MiB) — larger files are **ignored, not truncated** | `lib/index.js:19, 603-605` |
| Disable sentinel | `maxBytes <= 0` or non-finite disables loading | `lib/index.js:668-669` |

- **[CODE]** budget algorithm (`:293-372`): full render if it fits; else drop broader files from the
  front; else binary-search a byte budget for the most-specific file; else a compact notice. Rendered
  bytes never exceed `maxBytes`.
- **[CODE]** truncation notice (`:249-255`):
  `` `Workspace instruction budget ${maxBytes} bytes: ${parts.join("; ")}` `` where parts are
  `omitted <paths>` and `truncated <path> from N to M bytes`.
- **[CODE]** compact intro (`:116`): `"Workspace instructions were omitted or truncated to fit the configured byte budget."`
- **[CODE]** truncation is UTF-8 continuation-byte safe (`:120-126`).

**Automatic**; no user command. Nested/changed/removed instruction files are pulled into the inbox
when an `fs`-touching tool (`FILE_TOUCH_TOOL_NAMES`) runs (`:1091-1096`, `:1289-1308`).

---

## 12. Mechanism: `dsh-agent-tool-presentation` — **premise correction**

It is a **presentation selector**, not an output truncator.

- **[CODE]** `lib/index.js:31-35` `Config = z.object({ mode: z.union(["native","ptc","both"]).required() })`
- **[CODE]** `:41-49` `if (config.mode === "native") { ctx.tools.presentAs("native"); return; }`
  else `runtimeCtx.tools.presentAs(config.mode)` after `ctx.inject(["codeRuntime"], …)`.
- **[README]** ":97 the row only chooses between the two projections `dsh-tools` owns and registers
  no prompt, schema, or result of its own."
- **[INFERENCE]** no per-tool output cap is introduced here; caps come from the tool plugins, the
  spill policy, and the pruner.

---

## 13. Mechanism: `dsh-agent-loop` (assembly, placement, usage recording)

- **[CODE]** no truncation and no context budget. The request is derived wholesale:
  `lib/index.js:1204-1217` `const boundaryMessages = session.deriveMessages(); … messages: boundaryMessages`.
  [README] ":121 The request is `header.config`, `deriveMessages()`, and `header.tools`; it carries no
  `system` field."
- **[CODE]** system prompt projection per attempt (`:1019-1028`):
  `this.systemPrompt.project(renderedPrompt, { inHistory: preparedCall?.systemPromptUpdate === "in-history", startsSeries: startsRequestSeries || this.requestSurfaceGeneration !== this.session.surface.replaceGeneration || this.toolsChanged(assembly.tools) })`
  then `session.append("system/message", …)`.
- **[CODE]** `request/context` (provider, model, `contextWindow`, `systemPromptUpdate`) is logged
  only when it changes (`:1194-1201`) — again cache-friendly.
- **[CODE]** usage is recorded from the adapter and attached to `assistant/message`
  (`:1108-1114`, interrupted path `:1050-1064`).
- **[CODE]** `:1226` `const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10;` (scheduler bound, not context).
- [README] ":200 No built-in turn budget…" — a runaway-turn bound must come from an extension point.
- [README] ":160 KV-cache rule: 'Append-only only while system text, schemas, and earlier history
  remain byte-identical under the same provider and model route… A schema or composition change
  invalidates reuse from the first altered request token.'"

---

## 14. Mechanism: session persistence & usage accounting

- **[CODE]** one JSONL record per event; envelope keys are fixed
  (`type`, `seq`, `time`, `data`, optional `ignorable`, `sourceEventSeqs`, `surfaceOp`) —
  `dsh-session-format-v1-to-v2/lib/index.js:163-174`.
- **[CODE]** writer: `dsh-session-persistence-jsonl/lib/index.js:945-955` (`JSON.stringify(encodeCurrentEvent(event))`),
  appended in batches (`:3026-3048`), default physical encoding zstd.
- **[CODE]** `usage` is an admitted optional field of `assistant/message` in the released format
  (`dsh-session-format-v1-to-v2/lib/index.js:13-20`), and the persisted value must deep-equal the
  usage reassembled from the embedded stream
  (`dsh-session-persistence-jsonl/lib/index.js:1845`).
- **[CODE]** compaction metadata is persisted as ordinary events: `compaction/start|summary|end|prune`,
  with `shadowedTokenCount` and (on summary) `usage` — codec dispositions at
  `dsh-session-format-v0-to-v1/lib/index.js:53-74`.
- **The writer does NOT truncate tool outputs.** Pruning/compaction are surface *replacements*
  (new events appended), so **on-disk content ≥ what the model sees** (modulo zstd). [INFERENCE]
- **[CODE]** `dsh-session-query` exposes **no** usage/token/cost column or JSON path
  (`dsh-session-query-sqlite` schema has none). Usage is readable only by parsing the raw event.
- **[CODE]** `dsh-session-log-deepseek` is **not** a local request log. Default
  `enabled: false` (`lib/index.js:16`); when enabled it injects a top-level DeepSeek HTTP request
  field `dsh_session_log` containing the session header plus the event suffix since the last
  accepted watermark (`:117-145`), and appends a durable
  `session-log-deepseek/delivery-accepted` event on HTTP 2xx. `wireEvent` passes `data` through
  verbatim, so usage is included in the upload.
- **[CODE]** JSONL envelope keys are exactly `{type, seq, time, data}` + optional
  `{ignorable, sourceEventSeqs, surfaceOp}` (`dsh-session-format-v1-to-v2/lib/index.js:163-174`);
  the only writer "compaction" is lossless collapsing of contiguous `sourceEventSeqs` runs to
  `[start,end]` pairs (`:296-302, 327-342`). Default physical encoding is **zstd**.
- **[CODE]** the `usage` payload is schema-validated to exactly
  `inputTokens, outputTokens` (required) + `totalTokens, cacheReadTokens, cacheWriteTokens,
  reasoningTokens` (optional) (`dsh-session-format-v0-to-v1/lib/index.js:638-646`).
- **[CODE]** `request/context` persists the route's `contextWindow` and `systemPromptUpdate`
  (`dsh-session/lib/types/types.d.ts:217-226`; `dsh-session-format-v0-to-v1/lib/index.js:121`).
- Derived-only aggregates: `tokenUsage`, `contextPressure`, `contextBreakdown` (token-meter,
  registered at `dsh-token-meter/lib/index.js:615-617`), the exact per-Turn fold
  `deriveTurnTokenUsage` (`dsh-token-meter/lib/types/turn-usage.d.ts`), and `sessionStats`
  (`decodeTokens`, turn/step counts, latencies). **[CODE]** projection **caches** live in a separate
  store, `dsh-session-projection-cache` domain `session_projcache` v7
  (`lib/index.js:89-91`), not in the canonical log.
- **[CODE]** the client context meter reads `useProjection("contextPressure")`
  (`dsh-client-ui-conversation/lib/client.js:15414`) — this is the "N tokens" readout.
- **Cost: none.** No `cost`/`usd`/price field in any back-end package. [INFERENCE] dollars are
  computed outside DSH.

---

## 15. Mechanism: subagent context isolation (fork vs spawn)

### Fork (`dsh-subagent-fork-in-process`)

- **[CODE]** `lib/index.js:23-28`
  ```js
  function completedTurnPrefix(parent) {
      const events = parent.session.snapshotEvents();
      const lastEnd = events.findLast((e) => e.type === "turn/end");
      if (lastEnd === void 0) return [];
      return events.slice(0, lastEnd.seq + 1);
  }
  ```
- **[CODE]** `:44` `inheritsParentContext = true;`; `:48-51` seeds the child with the prefix.
- **[CODE]** the driver pins the boundary: `dsh-subagent-in-process-driver/lib/index.js:167-168`
  `const seed = options.seed; const activationBoundary = SessionLogOffset(seed?.length ?? 0);`
  and passes `{ seed }` + `inheritedEventCount` (or nothing when undefined) at `:180-186`.
- **Prefix = all events seq 0 … the last `turn/end`** (completed turns only, contiguous).
  **No byte/token/message/turn cap exists** on the seed. [INFERENCE] seed size is bounded only by the
  parent log and the model window.
- [README] fork ":12 The seed is a one-time snapshot taken at fork time: later parent turns never
  reach the child."

### Spawn (`dsh-subagent-spawn-in-process`)

- **[CODE]** `lib/index.js:30` `inheritsParentContext = false;`; `:34-39` `start(request) { return startInProcessRun(request, {}); }`
  — `{}` ⇒ no seed, boundary 0. Only context is the prompt:
  `dsh-subagent-in-process-driver/lib/index.js:207-210` `child.followup(createUserMessage({ content: prompt, source: { kind: "user" } }));`
- [README] spawn ":12 The child starts with an empty conversation, so a task prompt must stand alone."

### What crosses back

- **[CODE]** only the child's **final assistant message**: driver `:231-251` `const output = finalAssistantOutput(own) ?? [];`
  (last non-empty `assistant/message`, else accumulated streamed text —
  `dsh-subagent/lib/index.js:203-210`). The tool forwards `output: result.output`
  (`dsh-tool-subagent/lib/index.js:315-323`) and renders text blocks only.
- **No truncation of the child's final message.** The only cap is on failure diagnostics:
  **[CODE]** `dsh-subagent/lib/index.js:2475-2476`
  `const MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4096; const DIAGNOSTIC_TRUNCATION_SUFFIX = "\n[diagnostic truncated]";`

### Tool parameters and caps

- **[CODE]** `dsh-tool-subagent/lib/index.js:401-430`: required `description`, required `prompt`;
  optional `provider`, `model`, `reasoning_effort` (only when `modelSelectionSettings: true`);
  optional `run_in_background` (when enabled). `subagent_fork` is the same tool bound to
  `provider: fork` (`toolName`/`provider` are config, `:250-269, :373`).
- **[CODE]** control tools: `send_message { agent_id, message }`, `interrupt_agent { agent_id }`
  (`dsh-tool-subagent-control/lib/index.js:25-36, 64-68`).
- **[CODE]** `dsh-tool-subagent/lib/index.js:269`
  `maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const("provider-managed")]).default(3)`,
  enforced at `dsh-subagent/lib/index.js:432-436`.
- **No `maxAgents`/`maxChildren`/subagent-concurrency cap found.** Related:
  `DEFAULT_MAX_CONCURRENT_TASKS_PER_OWNER = 10` (`dsh-jobs-local/lib/index.js:77`),
  `COLD_READ_CONCURRENCY = 4` (`dsh-subagent/lib/index.js:2054`); the subagent tool is marked
  `isConcurrencySafe: () => true` (`dsh-tool-subagent/lib/index.js:489`).

---

## 16. Summary table of constants / limits

| Mechanism | Constant / limit | Default | Trigger | Model sees | Invocation | Evidence |
|---|---|---|---|---|---|---|
| Auto-compaction trigger | `DEFAULT_THRESHOLD_RATIO` | `0.8` × `contextWindow` | `totalTokens >= thresholdTokens` at `agent/pre-step` | (summary replaces span) | automatic | `dsh-compaction-basic/lib/index.js:15,111,900` |
| Auto-compaction retention | `DEFAULT_RETAIN_RATIO` | `0.16` × window | recent tail kept verbatim | — | automatic | `:17,112` |
| Summary generation cap | `maxTokens` | `8192` | summarizer call | — | automatic/manual | `:72` |
| Compaction retries | `compactionRetries` | `1` | still above threshold | — | automatic | `:73,907` |
| Overflow retries | `maxOverflowRetries` | `1` | `CONTEXT_WINDOW_EXCEEDED_CODE` | — | automatic | `:74,821-827` |
| Auto enabled | `auto` | `true` | — | — | config | `:76,786` |
| DeepSeek route window | `DEFAULT_CONTEXT_WINDOW` | `1e6` | — | — | config | `dsh-llm-deepseek/lib/index.js:1392,1845-1866` |
| pi-ai assumed window | `DEFAULT_CONTEXT_WINDOW` | `262144` | — | — | config | `dsh-llm-pi-ai/lib/index.js:893` |
| Checkpoint summary tags | `SUMMARY_OPEN_TAG` / `CLOSE` | `<compacted-summary>` / `</compacted-summary>` | after summary | preamble + tags + summary | both | `dsh-compaction-basic/lib/index.js:211-212,257,323-335` |
| Tool-result prune | `thresholdChars` | `8192` code points | > threshold **and** compaction trigger | head 4096 + marker + tail 1024 | automatic | `dsh-compaction-tool-result-pruner/lib/index.js:10-14,93` |
| Prune marker | `PRUNE_MARKER` | `"\n\n[... tool result middle pruned ...]\n\n"` | — | literal marker | — | `:8` |
| Generic result spill | `maxInlineBytes` | `50000` bytes | final text > cap, not `read`, not nested | head/tail preview + spill path | automatic | `dsh-base/cordis.patch.yml:386`; `dsh-spill-policy/lib/index.js:146-157,161` |
| Spill hint | `retrievalHint` | `"Use read with offset/limit, or grep this path to search within it."` | — | — | — | `dsh-spill-local/lib/index.js:566` |
| `/compact` | command name | `compact` (no aliases), no args | user | summary node | manual | `dsh-command-compact/lib/index.js:9,49,54,92-96` |
| Durability checkpoint | `ctx.sessions.flush` | n/a | `llm/stream`, top-level `tools/execute`, `agent/pre-step` | nothing | automatic | `dsh-session-checkpoint-policy/lib/index.js:26-31,60-76` |
| Read window | `READ_LIMIT` | `2000` lines | every `read` | `(Showing lines a-b of N. Use offset=…)` | automatic | `dsh-tool-fs/lib/index.js:293,103-105` |
| Read bytes | `READ_MAX_BYTES` | `51200` | window > cap | `(Output capped. …)` | automatic | `:18,103` |
| Read line length | `READ_MAX_LINE_LENGTH` | `2000` chars | line longer | `... (line truncated to 2000 chars)` | automatic | `:16,27-28` |
| Bash per stream | `maxOutputBytes` | `64000` | output > cap | tail + `[output truncated; full output: <path>]` | automatic | `dsh-bash-local/lib/index.js:132`; `dsh-tool-bash/lib/index.js:38-42` |
| Bash spill | `maxSpillBytes` | `64 MiB` | spill needed | spill path | automatic | `dsh-bash-local/lib/index.js:88-89` |
| PTY output | `maxOutputChars` | `16000` chars | > cap | head cut + `TRUNCATED_MESSAGE` | automatic | `dsh-tool-bash-persistent/lib/index.js:365,68,76-79` |
| PTY scrollback | `scrollbackLines` / `scrollbackMaxBytes` | `10000` lines / `4 MiB` | eviction | oldest dropped, `truncated: true` | automatic | `dsh-terminal-bash/lib/index.js:44-45` |
| PTY read page | `maxReadBytes` / count | `256 KiB` / `500` lines | `read` | bounded page | automatic | `dsh-terminal-bash/lib/index.js:46,520-546` |
| Instruction budget | `maxBytes` | `65536` B | render > budget | `Workspace instruction budget 65536 bytes: …` | automatic | `dsh-base/cordis.patch.yml:271`; `dsh-agent-instructions/lib/index.js:249-255,293-372` |
| Instruction source | `maxSourceBytes` | `1048576` B | file > cap | file **ignored** | automatic | `dsh-agent-instructions/lib/index.js:19,603-605` |
| Token estimator | `CHARS_PER_TOKEN` / `BLOCK_OVERHEAD` / `ROLE_OVERHEAD` | `4` / `4` / `4` | always (pricing only) | — | automatic | `dsh-token-meter/lib/index.js:16-18`; `estimate.d.ts` |
| Parallel tool calls | `DEFAULT_MAX_PARALLEL_TOOL_CALLS` | `10` | scheduler | — | automatic | `dsh-agent-loop/lib/index.js:1226` |
| Subagent depth | `maxDepth` | `3` | delegation depth | depth error | automatic | `dsh-tool-subagent/lib/index.js:269`; `dsh-subagent/lib/index.js:432-436` |
| Subagent diagnostics | `MAX_SUBAGENT_DIAGNOSTIC_BYTES` | `4096` | failure | truncated diagnostic | automatic | `dsh-subagent/lib/index.js:2475-2476` |

---

## 17. Notable design choices

1. **Compaction is aggressive in mechanism but conservative in default threshold.** 0.8 of a 1e6-token
   window on the default route means DSH effectively never compacts for ordinary sessions — the
   observed 285K / 25-minute run is well inside budget. Compaction is a *safety net*, not a routine
   context manager.
2. **Two independent shrink mechanisms with different contracts.** `spill-policy` is **lossless and
   recoverable** (writes a file, gives the model a path) and runs on every oversized plain-text
   result; the `tool-result-pruner` is **lossy and non-recoverable in context** (in-band marker only)
   and only runs *after* a compaction trigger. The recoverable one fires first, so the pruner mostly
   handles what is already in history.
3. **The pruner has no tool allow-list and no on/off switch**; the only exclusion is `read` in the
   *spill* arm (to avoid a `read → spill → read again` loop) and nested/`value`-replacement decisions.
4. **Compaction never touches the system prompt or tool schemas.** `selectCompactableRange` starts at
   the first non-system node, and `toolPairingBalancedBefore` prevents splitting tool pairs. [README]
   confirms the system prompt and schemas are paid on every step regardless.
5. **Cache-aware by construction.** The system prompt is a history node; on `in-history` routes a
   changed prompt is appended after the cached prefix instead of rewriting node 0; volatile runtime
   context is a separate `user/message` emitted only when its text changes; the summarizer replays the
   conversation prefix and appends only the instruction; fork children share the parent's
   provider/model explicitly "so the inherited history remains eligible for KV Cache reuse."
6. **Fail-closed shrink gate.** A summary that is not strictly smaller than the shadowed content is
   rejected (`:572`), and a truncated summary is an error (`MAX_TOKENS`) — DSH never trades context for
   a no-op or a partial checkpoint.
7. **Usage accounting is exact when the provider reports it and heuristic otherwise.** The meter
   anchors to provider usage but falls back to a 4-chars/token estimate, and the mix is explicitly
   labelled "a user-facing reference, not a billing or gating input." Compaction thresholds inherit
   that dual nature.
8. **Cache-write accounting is provider-shaped, not universal.** DeepSeek exposes only cache *reads*
   (`prompt_cache_hit_tokens`); `cacheWriteTokens` exists for Anthropic-style routes via pi-ai.
   `prompt_cache_miss_tokens` is parsed but folded into `inputTokens`.
9. **The durable log is the source of truth and is never rewritten.** Pruning and compaction append
   replacement events with `sourceEventSeqs`, so on-disk content is a superset of what the model saw;
   `session-query` deliberately exposes no token aggregation, so usage analysis must replay the log.
10. **"Checkpoints" in `dsh-session-checkpoint-policy` are durability flushes, not context
    snapshots** — a naming collision worth knowing when comparing against my-pi's checkpoint concept.

---

## 18. Premises corrected / not found

| Premise in the brief | Finding |
|---|---|
| `dsh-fs-observation-policy` bounds file reads / observations | **False.** It is a read-before-edit version-CAS gate with no size limits. Read caps are in `dsh-tool-fs`. |
| "read before claim" policy | **Not found.** The enforced rule is read-before-**edit/overwrite** (`FS_NOT_OBSERVED`). |
| `dsh-agent-tool-presentation` truncates tool output | **False.** It selects `native`/`ptc`/`both` tool presentation; it registers no output handling. |
| `dsh-terminal` truncates tool output | **False at that layer.** Bounds live in `dsh-terminal-bash` (scrollback/read page) and `dsh-tool-bash-persistent` (head cut). |
| `dsh-compaction` has thresholds / a `shouldCompact` | **False.** Pure seam; no numeric defaults; `shouldCompact` does not exist. |
| `dsh-session-log-deepseek` logs request/response payloads | **False.** It uploads a `dsh_session_log` request field to the DeepSeek API (opt-in, default off); no local payload log. |
| Reserved output tokens / safety margin constant | **Not found.** The only headroom is the 0.8 ratio gap plus the 8192 summary cap. |
| Monetary cost accounting | **Not found** in any back-end package. |
| Explicit cache-TTL handling | **Not found** in DSH; only pi-ai passthrough compat flags (`cacheControlFormat`, `supportsLongCacheRetention`, `supportsCacheControlOnTools`). |

---

## 19. Open questions / residual uncertainty (all inference-labelled)

1. **What exactly the UI displayed as "285K".** If it was `contextPressure.projectedTokens`, the
   conclusion (below the 800K trigger) is exact. If it was the cumulative `tokenUsage` sum, the gate
   still uses `measure().totalTokens`. Either way the 1e6 window explains no compaction.
2. **The route actually in use for that session.** The default is `deepseek-official/deepseek-flash`
   (1e6). A user-selected pi-ai route (262,144 assumed) would put 285K above the 209,715 trigger,
   so route determines the answer.
3. **Whether `compactIfNeeded`'s `selectCompactableRange` ever returned `null`** in that session
   (e.g. because the tail could not be balanced) — the code returns `null` rather than forcing a cut.
4. **Cache TTL refresh policy** is delegated to the provider/pi-ai library; DSH has no explicit
   breakpoint placement code of its own.
