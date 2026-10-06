#!/bin/bash
# lib-mode.sh — 模式解析的共享逻辑（被 pi-supervisor.sh / dev.sh source）
#
# 为什么独立成库：模式 = 启动档位，必须在**每个** pi 入口一致地应用——supervisor 要把
# 人设注入 `--append-system-prompt`、把记忆命名空间注入 `PI_MEMORY_NAMESPACE`，而
# `scripts/dev.sh` 直接跑源码，同样需要。此前这段逻辑只写在 pi-supervisor.sh 里，
# 于是 dev.sh 静默不注入人设（入口漂移，实测确认）。
#
# 数据来源（职责分离，别合并；详见 custom/features/mode/logic.ts 的注释）：
#   $AGENT_DIR/modes.json           入库配置：default + 自定义模式定义
#   $AGENT_DIR/modes-sessions.json  会话模式记录：<会话文件绝对路径> → { mode, updatedAt }（gitignored）
#
# 用法（被 source 后调用）：
#   mode_resolve <agent_dir> [session_file]   # 设置 MODE_NAME / MODE_NS / MODE_APPEND_ABS
#   mode_args                                 # 打印应附加的启动参数（每行一个，供 readarray 用）
#   mode_session_arg <args...>                # 从启动参数里取最后一个 --session <绝对路径>
#
# 语义与 custom/features/mode/logic.ts 的 resolveEffectiveMode 保持一致（两处必须一起改）：
#   1) 外部注入的 PI_AGENT_MODE 优先（启动器/测试覆盖用）
#   2) 否则按**本次要加载的会话**查记录（mode_session_arg 解析出来的精确路径）
#   3) 都没有 → modes.json 的 default（新会话的档位）
#
# 必须区分"外部注入"与"bootstrap 回写"：bootstrap 会把解析结果写回 `PI_AGENT_MODE`
# 作为进程内标记。若不加区分，每次 mode_resolve 都会读到上一次的旧值，模式永远切不动
# （正是 pi 侧 resolveEffectiveMode 注释里点名的坑）。来源由 bootstrap 写入
# PI_AGENT_MODE_SOURCE；未设置时视为外部注入（兼容 launcher/测试直接注入）。
#
# 2026-10-05 修：此前只看 PI_AGENT_MODE 非空，与 pi 侧语义不一致——pi 进程内 bootstrap
# 回写的 PI_AGENT_MODE=<旧模式> 会被 bash 侧当成外部注入，于是 supervisor 每次拉起都
# 沿用上次的模式（实测表现：状态文件 roleplay 却按 full 启动，test-supervisor 5 项红）。
#
# 2026-10-06 改（会话作用域）：模式不再是"本机全局选择"，而是**会话属性**——
# 新会话用 default、续接会话用它自己记录的模式。bash 只认 `--session <绝对路径>` 这种
# 精确形态；`-c`/`-r`/部分 uuid 等形态它解析不出来，故意**不做**第二套会话查找逻辑
# （那会与 pi 的解析规则漂移），交给 pi 侧 session_start 的一致性校验自愈重启。

# 从启动参数里取最后一个 `--session <绝对路径>`。
# 只认绝对路径：`--session` 也接受会话 id / 部分 uuid，那是 pi 的查找语义，bash 不复制。
# 取"最后一个"是因为 supervisor 的 argv 形如 `... $@ --session <目标>`：后出现的才是生效值
# （pi 的 args 解析同样是后者覆盖前者）。
mode_session_arg() {
  local prev="" a out=""
  for a in "$@"; do
    if [ "$prev" = "--session" ]; then
      case "$a" in
        /*) out="$a" ;;
      esac
      prev=""
      continue
    fi
    prev="$a"
  done
  printf '%s' "$out"
}

# 解析模式配置。结果写入三个全局变量：
#   MODE_NAME        生效模式名
#   MODE_NS          记忆命名空间（可能为空）
#   MODE_APPEND_ABS  人设追加文件绝对路径（无配置或文件不存在时为空）
#
# 第二个参数（会话文件）可省略；省略时等于"新会话"，走 default。
mode_resolve() {
  local agent_dir="$1" session_file="${2:-}"
  MODE_NAME=""; MODE_NS=""; MODE_APPEND_ABS=""
  local out
  # 字段用 US(0x1f) 分隔：TAB 属空白字符，IFS 会把连续分隔符折叠，中间字段为空时整体错位
  # （历史上 set_model 缺 targetSession 时 PROVIDER/MODEL 串位就是这个坑）。
  out=$(node -e '
const fs=require("fs");
// 与 pi 侧 resolveEffectiveMode 同一判据（两处必须一起改）：
//  1) source 缺省或 "env" 才算外部注入；bootstrap 回写写的是 source="file"。
//  2) 候选模式名必须**已知**——pi 侧注入时走 getModeConfig(env) 校验，会话记录走
//     modes[name] 校验，default 也要已知。这里用同一判据：modes.json 的 modes ∪ 固定档。
const FIXED=["full","minimal"];
let ns="",ap="",mode="";
try{
  const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const known=(n)=>Boolean(n)&&(FIXED.includes(n)||Boolean(cfg.modes&&cfg.modes[n]));
  const src=process.env.PI_AGENT_MODE_SOURCE;
  const envAllowed=src===undefined||src==="env";
  const env=process.env.PI_AGENT_MODE;
  if(envAllowed&&known(env)) mode=env;
  if(!mode){
    const sessionFile=process.argv[3]||"";
    let rec="";
    if(sessionFile){
      try{
        const v=JSON.parse(fs.readFileSync(process.argv[2],"utf8"))[sessionFile];
        if(v&&typeof v==="object"&&typeof v.mode==="string") rec=v.mode;
      }catch{}
    }
    mode=[rec,cfg.default,"full"].find(known)||"full";
  }
  const m=(cfg.modes&&cfg.modes[mode])||null;
  if(m){ ns=m.memoryNamespace||""; ap=m.appendPrompt||""; }
}catch(e){ mode="full"; }
process.stdout.write([mode,ns,ap].join("\u001f"));
' "$agent_dir/modes.json" "$agent_dir/modes-sessions.json" "$session_file" 2>/dev/null)
  IFS=$'\x1f' read -r MODE_NAME MODE_NS MODE_APPEND_ABS <<<"$out"
  # 人设文件不存在就当没配：缺文件时静默不注入优于启动失败，但也不能假装注入了
  if [ -n "$MODE_APPEND_ABS" ]; then
    if [ -f "$agent_dir/$MODE_APPEND_ABS" ]; then
      MODE_APPEND_ABS="$agent_dir/$MODE_APPEND_ABS"
    else
      MODE_APPEND_ABS=""
    fi
  fi
}

# 打印启动参数：每行一个，调用方用 readarray -t 收集（无参数时输出为空）
mode_args() {
  if [ -n "${MODE_APPEND_ABS:-}" ]; then
    printf -- '--append-system-prompt\n%s\n' "$MODE_APPEND_ABS"
  fi
}
