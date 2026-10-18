# 升级到 DSH 0.2.1（含关闭登录）——执行清单

> 现状：仓内宿主 `0.2.0-rc.2`（npm `latest`）。
> npm 上 `0.2.1` 目前只有预发布：`next = 0.2.1-rc.2`（`alpha = 0.2.1-alpha.5`）。
> **等 0.2.1 稳定版发布再正式升级**；急用可先升到 `0.2.1-rc.2` 试跑。

## 1. 升级前（打底）

```bash
git switch feat/private-assistant && git pull
assistant/scripts/verify-m1.sh            # 先在旧版上全绿，作为对照基线
bash scripts/dsh-runtime.sh status         # 记下当前版本/落点
bash scripts/dsh-runtime.sh doctor         # 版本漂移/产物/凭据/profile 体检
cp -a runtime/linux-arm64/ext/dsh runtime/linux-arm64/ext/dsh.bak-0.2.0-rc.2   # 本地快照（gitignored，方便回滚）
```

## 2. 升级（四步，缺一不可）

```bash
# ① 改版本钉：scripts/dsh-runtime.sh 里的 DSH_VERSION
#    DSH_VERSION="0.2.1-rc.2"（或稳定版 "0.2.1"）
# ② 重装宿主（进仓内 runtime/，可重复执行）
bash scripts/dsh-runtime.sh install
# ③ 重构建产物（插件的 @deepseek-ai/* 是 external，由宿主提供）
bash scripts/dsh-build.sh
# ④ 体检 + 冒烟
bash scripts/dsh-runtime.sh doctor
bash scripts/dsh-host-smoke.sh
assistant/scripts/verify-m1.sh
```

## 3. 升级要看什么（0.2.1 的"我需要的改进"）

你提到 0.2.1 有需要的改进，具体是哪几条请补一下；通用检查清单：

- [ ] 组合行变化：`--dump-config` 与升级前对比（`assistant/baseline/mounts-before.txt` 是旧基线）；
      行 id 变了 ⇒ 我们的 patch（`mypi.patch.yml` / `no-login.patch.yml` / `local-preset.patch.yml` / `schedule.patch.yml`）要跟着改；
- [ ] 登录三行是否还在：`deepseek-account` / `llm-deepseek-account` / `ui-settings-account`——**0.2.1 若改名，no-login 会静默失效**（我们的断言会抓到）；
- [ ] `compaction-basic` 的配置字段是否变化（我们依赖 `thresholdRatio/headroomTokens/retainTokens/maxTokens` 与 inline 覆盖）；
- [ ] `agent-preset` 的 schema 是否变化（我们的 `local` preset 依赖 `isolate`/`cordis:group`）；
- [ ] `ctx.web.registerSearchProvider` 签名是否变化（SearXNG provider）；
- [ ] 事件形状是否变化（我们监听 `session/event` 的 `user/message`、`tool/call`、`tool/result`、`turn/end`、`assistant/message`）；
- [ ] 0.2.1 的改进项逐条验证（请补充清单后我加进这里）。

## 4. 关闭登录（已默认生效，升级后要复核）

我们的默认组合已经带 `profile/no-login.patch.yml`，禁用三行：

| 行 id | 包 | 作用 |
|---|---|---|
| `deepseek-account` | `dsh-deepseek-account-platform` | 浏览器登录 + 本地凭据 |
| `llm-deepseek-account` | `dsh-llm-deepseek-account` | `deepseek-account` provider 的鉴权与模型发现 |
| `ui-settings-account` | `dsh-client-ui-settings-account` | 设置页账号区块 / 侧边栏登出 |

保留：`llm-deepseek`（`dsh-llm-deepseek-api-key`，走 `DEEPSEEK_API_KEY`）、`authorization`（其他 provider 可能用）。
恢复登录：`MYPI_LOGIN=1`。断言：`bash assistant/test/no-login.sh`（verify 第⑳步）。

升级后**必须重跑这个断言**：如果 0.2.1 改了行 id，脚本会报 `targetedDisabled < 3`。

## 5. 回滚

```bash
# 方式一：快照还原
rm -rf runtime/linux-arm64/ext/dsh && mv runtime/linux-arm64/ext/dsh.bak-0.2.0-rc.2 runtime/linux-arm64/ext/dsh
# 方式二：改回 DSH_VERSION 重装
DSH_VERSION=0.2.0-rc.2 bash scripts/dsh-runtime.sh install && bash scripts/dsh-build.sh
assistant/scripts/verify-m1.sh
```

回滚只需要动 `runtime/`（gitignored），**不产生提交**；但 `scripts/dsh-runtime.sh` 的 `DSH_VERSION` 改动要一起回退。
