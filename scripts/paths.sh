#!/usr/bin/env bash
# ============================================================
# paths.sh — 路径集中定义
# 所有脚本通过 source 此文件获取路径变量，避免硬编码
# 目录结构调整时只需修改此文件
# ============================================================
# 用法: source "$(dirname "$0")/paths.sh"
# 或:   source "$PROJECT_SCRIPTS_DIR/paths.sh"

# ---- 基础路径 ----
# PI_HOME: Pi 配置仓库根目录（默认 ~/.pi，可通过环境变量覆盖）
PI_HOME="${PI_HOME:-$HOME/.pi}"

# PROJECT_ROOT: 项目根目录（my-pi 仓库根）
# 自动检测：从 paths.sh 所在位置向上查找
if [ -z "${PROJECT_ROOT:-}" ]; then
  _SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$_SCRIPTS_DIR/.." && pwd)"
  unset _SCRIPTS_DIR
fi

# PROJECT_SCRIPTS_DIR: 脚本目录
PROJECT_SCRIPTS_DIR="${PROJECT_SCRIPTS_DIR:-$PROJECT_ROOT/scripts}"

# ---- 核心配置文件 ----
SETTINGS_JSON="$PI_HOME/settings.json"
MODELS_JSON="$PI_HOME/models.json"
AUTH_JSON="$PI_HOME/auth.json"
MODES_JSON="$PI_HOME/modes.json"
KEYBINDINGS_JSON="$PI_HOME/keybindings.json"
MODELS_STORE_JSON="$PI_HOME/models-store.json"

# ---- 扩展目录 ----
EXTENSIONS_DIR="$PI_HOME/extensions"

# ---- 服务层目录 ----
SERVICES_DIR="$PI_HOME/services"
CORE_DIR="$PI_HOME/core"
SKILLS_DIR="$PI_HOME/skills"

# ---- 运行时数据 ----
DATA_DIR="$PI_HOME/data"
MEMORY_DIR="$PI_HOME/memory"
LOGS_DIR="$PI_HOME/logs"
SESSIONS_DIR="$PI_HOME/sessions"
STATS_DIR="$PI_HOME/stats"

# ---- 二进制工具 ----
AGENT_BIN_DIR="$PI_HOME/agent/bin"
FD_BIN="$AGENT_BIN_DIR/fd"
RG_BIN="$AGENT_BIN_DIR/rg"

# ---- SearXNG ----
SEARXNG_DIR="$PI_HOME/searxng"
SEARXNG_VENV="$SEARXNG_DIR/venv"
SEARXNG_REPO="$SEARXNG_DIR/repo"
SEARXNG_SETTINGS="$SEARXNG_DIR/settings.yml"

# ---- 部署配置 ----
DEPLOY_DIR="$PI_HOME/deploy"
SYSTEMD_DIR="$DEPLOY_DIR/systemd"
TMUX_CONF="$DEPLOY_DIR/tmux/tmux.conf"

# ---- 脚本目录 ----
SCRIPTS_CORE_DIR="$PROJECT_SCRIPTS_DIR/core"
SCRIPTS_CRASH_RECOVERY_DIR="$PROJECT_SCRIPTS_DIR/crash-recovery"
SCRIPTS_INSTALL_DIR="$PROJECT_SCRIPTS_DIR/install"
SCRIPTS_TEST_DIR="$PROJECT_SCRIPTS_DIR/test"
SCRIPTS_MAINTENANCE_DIR="$PROJECT_SCRIPTS_DIR/maintenance"
SCRIPTS_TOOLS_DIR="$PROJECT_SCRIPTS_DIR/tools"

# ---- 常用脚本路径 ----
REBUILD_SCRIPT="$SCRIPTS_CORE_DIR/rebuild.sh"
PI_WRAPPER_SCRIPT="$SCRIPTS_CORE_DIR/pi-wrapper.sh"
SMOKE_TEST_SCRIPT="$SCRIPTS_TEST_DIR/smoke-test.sh"
TEST_ALL_SCRIPT="$SCRIPTS_TEST_DIR/test-all.sh"
INSTALL_CRON_SCRIPT="$SCRIPTS_INSTALL_DIR/install-cron.sh"
INSTALL_SYSTEMD_SCRIPT="$SCRIPTS_INSTALL_DIR/install-systemd.sh"
INSTALL_WRAPPER_SCRIPT="$SCRIPTS_INSTALL_DIR/install-wrapper.sh"

# ---- 扩展脚本路径函数 ----
# 获取扩展脚本路径: get_extension_script <扩展名> <脚本名>
get_extension_script() {
  local ext="$1" script="$2"
  echo "$EXTENSIONS_DIR/$ext/scripts/$script"
}

# 获取扩展配置路径: get_extension_config <扩展名> <配置文件>
get_extension_config() {
  local ext="$1" config="$2"
  echo "$EXTENSIONS_DIR/$ext/config/$config"
}

# ---- 路径验证函数 ----
# 验证关键目录和文件是否存在
validate_paths() {
  local errors=0

  # 检查 PI_HOME
  if [ ! -d "$PI_HOME" ]; then
    echo "ERROR: PI_HOME 不存在: $PI_HOME" >&2
    errors=$((errors+1))
  fi

  # 检查核心配置文件
  for f in "$SETTINGS_JSON" "$MODELS_JSON"; do
    if [ ! -f "$f" ]; then
      echo "WARNING: 配置文件缺失: $f" >&2
    fi
  done

  # 检查扩展目录
  if [ ! -d "$EXTENSIONS_DIR" ]; then
    echo "WARNING: 扩展目录不存在: $EXTENSIONS_DIR" >&2
  fi

  return $errors
}

# ---- 路径迁移辅助函数 ----
# 检查是否存在旧的 agent/ 路径引用
check_legacy_paths() {
  local file="$1"
  local legacy_count=0

  if [ -f "$file" ]; then
    # 检查旧路径模式
    legacy_count=$(grep -c "PI_HOME/agent/extensions\|PI_HOME/agent/settings\|PI_HOME/agent/models" "$file" 2>/dev/null || echo "0")
  fi

  echo "$legacy_count"
}

# ---- 导出环境变量（供子进程使用）----
export PI_HOME PROJECT_ROOT PROJECT_SCRIPTS_DIR
export SETTINGS_JSON MODELS_JSON AUTH_JSON
export EXTENSIONS_DIR SERVICES_DIR CORE_DIR SKILLS_DIR
