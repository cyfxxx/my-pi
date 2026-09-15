# my-pi 新设备部署指南

## 一、环境要求

### 系统要求
- **操作系统**：Linux (推荐 Ubuntu 22.04+) / macOS / Windows (WSL2)
- **内存**：4GB+ (推荐 8GB)
- **磁盘**：10GB+ 可用空间

### 软件要求
- **Node.js**：v22.x (推荐 v22.23.1+)
- **npm**：v10.x+
- **Git**：v2.x+
- **Python**：3.x (部分脚本需要)
- **ripgrep**：用于搜索功能
- **fd**：用于文件查找

## 二、快速部署（自动化脚本）

```bash
# 1. 克隆仓库
git clone git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi

# 2. 运行部署脚本
./scripts/deploy/setup-new-device.sh

# 3. 验证安装
mypi --list-models
```

## 三、手动部署步骤

### Step 1: 安装系统依赖

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y curl git python3 python3-pip ripgrep fd-find

# macOS
brew install git python3 ripgrep fd

# Termux (Android)
pkg install git python nodejs-lts ripgrep fd
```

### Step 2: 安装 Node.js

```bash
# 使用 nvm 安装
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# 验证
node --version  # 应显示 v22.x.x
npm --version   # 应显示 10.x.x
```

### Step 3: 克隆仓库

```bash
git clone git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi
```

### Step 4: 安装依赖

```bash
# 安装根依赖
npm install

# 安装扩展依赖
cd custom/extensions
npm install
cd ../..
```

### Step 5: 构建项目

```bash
# 离线构建（推荐）
npm run build:offline

# 或者完整构建
npm run build
```

### Step 6: 配置环境

```bash
# 创建配置目录
mkdir -p ~/.pi/agent

# 复制配置文件
cp custom/config/settings.json ~/.pi/agent/
cp custom/config/modes.json ~/.pi/agent/
cp custom/config/keybindings.json ~/.pi/agent/

# 配置 API 密钥（根据需要）
# 编辑 ~/.pi/agent/auth.json 添加 API 密钥
```

### Step 7: 安装 mypi 命令

```bash
# 创建符号链接
sudo ln -sf ~/my-pi/scripts/mypi /usr/local/bin/mypi

# 或者添加到 PATH
echo 'export PATH="$HOME/my-pi/scripts:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Step 8: 验证安装

```bash
# 测试 mypi 命令
mypi --list-models

# 运行冒烟测试
./scripts/test/smoke-test.sh
```

## 四、配置多设备同步

### 4.1 同步配置

```bash
# 从主设备同步配置到新设备
rsync -avz ~/.pi/agent/settings.json user@new-device:~/.pi/agent/
rsync -avz ~/.pi/agent/modes.json user@new-device:~/.pi/agent/
rsync -avz ~/.pi/agent/keybindings.json user@new-device:~/.pi/agent/

# 同步扩展
rsync -avz ~/.pi/agent/extensions/ user@new-device:~/.pi/agent/extensions/

# 同步服务
rsync -avz ~/.pi/agent/services/ user@new-device:~/.pi/agent/services/
```

### 4.2 同步 API 密钥

```bash
# 安全同步 API 密钥（使用 SSH）
scp ~/.pi/agent/auth.json user@new-device:~/.pi/agent/
scp ~/.pi/agent/models.json user@new-device:~/.pi/agent/
```

### 4.3 同步会话数据

```bash
# 同步会话历史
rsync -avz ~/.pi/agent/sessions/ user@new-device:~/.pi/agent/sessions/

# 同步统计数据
rsync -avz ~/.pi/agent/stats/ user@new-device:~/.pi/agent/stats/
```

## 五、处理远程仓库更新

### 5.1 检查更新

```bash
cd ~/my-pi

# 检查远程更新
git fetch origin

# 查看更新内容
git log HEAD..origin/main --oneline
```

### 5.2 应用更新

```bash
# 拉取更新
git pull origin main

# 重新构建
npm run build:offline

# 应用补丁
./scripts/apply-patches.sh

# 验证
mypi --list-models
```

## 六、处理数据未同步问题

### 6.1 检查未同步数据

```bash
# 检查会话数据
ls -la ~/.pi/agent/sessions/

# 检查统计数据
ls -la ~/.pi/agent/stats/

# 检查日志数据
ls -la ~/my-pi/logs/
```

### 6.2 同步数据

```bash
# 同步会话数据
rsync -avz user@main-device:~/.pi/agent/sessions/ ~/.pi/agent/sessions/

# 同步统计数据
rsync -avz user@main-device:~/.pi/agent/stats/ ~/.pi/agent/stats/

# 同步日志数据
rsync -avz user@main-device:~/my-pi/logs/ ~/my-pi/logs/
```

## 七、故障排除

### 7.1 构建失败

```bash
# 清理并重新构建
npm run clean
npm install
npm run build:offline
```

### 7.2 扩展加载失败

```bash
# 重新安装扩展依赖
cd custom/extensions
rm -rf node_modules
npm install
cd ../..

# 重新构建
npm run build:offline
```

### 7.3 配置文件损坏

```bash
# 恢复默认配置
cp custom/config/settings.json ~/.pi/agent/
cp custom/config/modes.json ~/.pi/agent/
```

### 7.4 API 密钥问题

```bash
# 检查 API 密钥配置
cat ~/.pi/agent/auth.json

# 重新配置 API 密钥
# 编辑 ~/.pi/agent/auth.json
```

## 八、自动化部署脚本

完整的自动化部署脚本位于 `scripts/deploy/setup-new-device.sh`：

```bash
#!/bin/bash
# my-pi 新设备自动化部署脚本

set -e

echo "=== my-pi 新设备部署 ==="

# 1. 检查系统依赖
echo "检查系统依赖..."
command -v node >/dev/null 2>&1 || { echo "需要安装 Node.js"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "需要安装 npm"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "需要安装 git"; exit 1; }

# 2. 检查 Node.js 版本
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "需要 Node.js v22+，当前版本: $(node -v)"
    exit 1
fi

# 3. 安装依赖
echo "安装依赖..."
npm install

# 4. 构建项目
echo "构建项目..."
npm run build:offline

# 5. 配置环境
echo "配置环境..."
mkdir -p ~/.pi/agent
cp custom/config/settings.json ~/.pi/agent/
cp custom/config/modes.json ~/.pi/agent/
cp custom/config/keybindings.json ~/.pi/agent/

# 6. 安装 mypi 命令
echo "安装 mypi 命令..."
sudo ln -sf ~/my-pi/scripts/mypi /usr/local/bin/mypi

# 7. 验证安装
echo "验证安装..."
mypi --list-models

echo "=== 部署完成 ==="
```

## 九、注意事项

1. **API 密钥安全**：不要将 API 密钥提交到 Git 仓库
2. **配置备份**：定期备份配置文件
3. **数据同步**：多设备间定期同步会话数据
4. **更新策略**：先在测试环境验证更新，再应用到生产环境
5. **故障恢复**：保留备份，以便快速恢复
