#!/bin/bash
# lib-mode.sh — 模式解析的共享逻辑（被 pi-supervisor.sh / dev.sh source）
#
# 为什么独立成库：模式 = 启动档位，必须在**每个** pi 入口一致地应用——supervisor 要把
# 人设注入 `--append-system-prompt`、把记忆命名空间注入 `PI_MEMORY_NAMESPACE`，而
# `scripts/dev.sh` 直接跑源码，同样需要。此前这段逻辑只写在 pi-supervisor.sh 里，
# 于是 dev.sh 静默不注入人设（入口漂移，实测确认）。
#
# 数据来源（两文件职责分离，别合并；详见 custom/features/mode/logic.ts 的注释）：
#   $AGENT_DIR/modes.json        入库配置：default + 自定义模式定义
#   $AGENT_DIR/modes-state.json  运行时状态：current（gitignored，git 操作不会回退它）
#
# 用法（被 source 后调用）：
#   mode_resolve <agent_dir>   # 设置 MODE_NAME / MODE_NS / MODE_APPEND_ABS
#   mode_args                  # 打印应附加的启动参数（每行一个，供 readarray 用）
#
# 语义与 custom/features/mode/logic.ts 的 resolveEffectiveMode 保持一致：
# 外部注入的 PI_AGENT_MODE 优先（启动器/测试覆盖用），否则读运行时状态文件。
#
# 必须区分"外部注入"与"bootstrap 回写"：bootstrap 会把解析结果写回 PI_AGENT_MODE
# 作为进程内标记。若不加区分，每次 mode_resolve 都会读到上一次的旧值，模式永远切不动
# （正是 pi 侧 resolveEffectiveMode 注释里点名的坑）。来源由 bootstrap 写入
# PI_AGENT_MODE_SOURCE；未设置时视为外部注入（兼容 launcher/测试直接注入）。
#
# 2026-10-05 修：此前只看 PI_AGENT_MODE 非空，与 pi 侧语义不一致——pi 进程内 bootstrap
# 回写的 PI_AGENT_MODE=<旧模式> 会被 bash 侧当成外部注入，于是 supervisor 每次拉起都
# 沿用上次的模式（实测表现：状态文件 roleplay 却按 full 启动，test-supervisor 5 项红）。
# 现在两侧同判据：source 区分来源 + 模式名必须已知，详见下方 mode_resolve。

# 解析模式配置。结果写入三个全局变量：
#   MODE_NAME        生效模式名
#   MODE_NS          记忆命名空间（可能为空）
#   MODE_APPEND_ABS  人设追加文件绝对路径（无配置或文件不存在时为空）
mode_resolve() {
  local agent_dir="$1"
  MODE_NAME=""; MODE_NS=""; MODE_APPEND_ABS=""
  local out
  # 字段用 US(0x1f) 分隔：TAB 属空白字符，IFS 会把连续分隔符折叠，中间字段为空时整体错位
  # （历史上 set_model 缺 targetSession 时 PROVIDER/MODEL 串位就是这个坑）。
  out=$(node -e '
const fs=require("fs");
// 与 pi 侧 resolveEffectiveMode 同一判据（两处必须一起改）：
//  1) source 缺省或 "env" 才算外部注入；bootstrap 回写写的是 source="file"。
//  2) 候选模式名必须**已知**——pi 侧注入时走 getModeConfig(env) 校验、状态文件走
//     merged.modes[state.current] 校验，未知名一律忽略。这里用同一判据：modes.json 的
//     modes ∪ 固定档（full/minimal，pi 侧 normalizeModesFile 会合并进来）。
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
    let cur="";
    try{ cur=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).current||""; }catch{}
    mode=[cur,cfg.current,cfg.default,"full"].find(known)||"full";
  }
  const m=(cfg.modes&&cfg.modes[mode])||null;
  if(m){ ns=m.memoryNamespace||""; ap=m.appendPrompt||""; }
}catch(e){ mode="full"; }
process.stdout.write([mode,ns,ap].join("\u001f"));
' "$agent_dir/modes.json" "$agent_dir/modes-state.json" 2>/dev/null)
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
