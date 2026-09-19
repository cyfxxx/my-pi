#!/bin/bash
# scripts/init-portable.sh — 初始化便携环境

set -e

MY_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTABLE="$MY_PI_ROOT/portable"
PI_CONFIG_DIR="${PI_CODING_AGENT_DIR:-$HOME/.my-pi/agent}"

echo "Initializing portable environment..."
echo "Project root: $MY_PI_ROOT"

# 创建便携目录结构
mkdir -p "$PORTABLE"/{config,sessions,extensions,skills,memory}

# 将 Pi 默认配置目录桥接到便携目录
if [ ! -L "$PI_CONFIG_DIR" ]; then
    mkdir -p "$(dirname "$PI_CONFIG_DIR")"
    ln -sf "$PORTABLE/config" "$PI_CONFIG_DIR"
    echo "Created symlink: $PI_CONFIG_DIR -> $PORTABLE/config"
else
    echo "Symlink already exists: $PI_CONFIG_DIR"
fi

# 桥接会话目录
PI_SESSION_DIR="$PI_CONFIG_DIR/sessions"
if [ ! -L "$PI_SESSION_DIR" ]; then
    ln -sf "$PORTABLE/sessions" "$PI_SESSION_DIR"
    echo "Created symlink: $PI_SESSION_DIR -> $PORTABLE/sessions"
else
    echo "Symlink already exists: $PI_SESSION_DIR"
fi

# 桥接扩展目录
PI_EXTENSION_DIR="$PI_CONFIG_DIR/extensions"
if [ ! -L "$PI_EXTENSION_DIR" ]; then
    ln -sf "$PORTABLE/extensions" "$PI_EXTENSION_DIR"
    echo "Created symlink: $PI_EXTENSION_DIR -> $PORTABLE/extensions"
else
    echo "Symlink already exists: $PI_EXTENSION_DIR"
fi

# 桥接技能目录
PI_SKILLS_DIR="$PI_CONFIG_DIR/skills"
if [ ! -L "$PI_SKILLS_DIR" ]; then
    ln -sf "$PORTABLE/skills" "$PI_SKILLS_DIR"
    echo "Created symlink: $PI_SKILLS_DIR -> $PORTABLE/skills"
else
    echo "Symlink already exists: $PI_SKILLS_DIR"
fi

# 桥接记忆目录
PI_MEMORY_DIR="$PI_CONFIG_DIR/memory"
if [ ! -L "$PI_MEMORY_DIR" ]; then
    ln -sf "$PORTABLE/memory" "$PI_MEMORY_DIR"
    echo "Created symlink: $PI_MEMORY_DIR -> $PORTABLE/memory"
else
    echo "Symlink already exists: $PI_MEMORY_DIR"
fi

echo ""
echo "Portable environment initialized successfully!"
echo "  Config:    $PORTABLE/config"
echo "  Sessions:  $PORTABLE/sessions"
echo "  Extensions: $PORTABLE/extensions"
echo "  Skills:    $PORTABLE/skills"
echo "  Memory:    $PORTABLE/memory"
