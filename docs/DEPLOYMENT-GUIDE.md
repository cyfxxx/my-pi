# my-pi 新设备部署指南

## 快速部署（推荐）

```bash
# 1. 克隆项目
git clone git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi

# 2. 运行部署脚本
./scripts/deploy/setup-new-device.sh

# 3. 验证安装
mypi --list-models
```

## 手动部署

### Step 1: 安装系统依赖

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y curl git python3 ripgrep fd-find

# macOS
brew install git python3 ripgrep fd
```

### Step 2: 安装 Node.js v22+

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 22
```

### Step 3: 克隆并构建

```bash
git clone git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi
npm install
npm run build:offline
```

### Step 4: 初始化配置

```bash
./scripts/setup-config.sh
./scripts/setup-env.sh
source ~/.bashrc
```

### Step 5: 验证

```bash
mypi --list-models
```

## 多设备同步

### 推送配置到新设备

```bash
# 在当前设备上执行
./scripts/deploy/sync-config.sh push user@new-device

# 在新设备上执行
./scripts/deploy/setup-new-device.sh --skip-build --skip-config
```

### 从旧设备拉取配置

```bash
./scripts/deploy/sync-config.sh pull user@old-device
```

## 配置目录结构

```
my-pi/
├── .pi/                          # 配置目录
│   ├── agent/                    # 代理配置
│   │   ├── settings.json         # 代理设置
│   │   ├── auth.json             # API 密钥
│   │   ├── models-store.json     # 本地模型存储
│   │   ├── modes.json            # 模式配置
│   │   └── sessions/             # 会话数据（git 忽略）
│   ├── core/                     # 核心模块
│   ├── services/                 # 服务
│   ├── extensions/               # 扩展
│   ├── skills/                   # 技能包
│   ├── settings.json             # 全局配置
│   ├── models.json               # 模型配置
│   └── data/                     # 运行时数据（git 忽略，为空）
├── scripts/                      # 脚本（项目级别）
└── packages/
    └── coding-agent/
        └── dist/bundle/cli.js    # 编译后的 bundle
```

## 符号链接

配置目录通过符号链接统一管理：

```
~/.pi -> /path/to/my-pi/.pi
```

这样：
- 所有配置集中在项目目录 `.pi/` 中
- `~/.pi` 符号链接指向项目目录
- 修改配置只需在项目目录中操作
- 多设备同步只需同步项目目录

## 故障排除

### mypi 命令找不到

```bash
# 检查符号链接
ls -la ~/.pi

# 重新初始化
./scripts/setup-config.sh
./scripts/setup-env.sh
```

### 扩展加载失败

```bash
# 重新安装扩展依赖
cd .pi/extensions
npm install
cd ../..
npm run build:offline
```

### 模型不可用

```bash
# 检查 models.json
cat .pi/models.json

# 检查符号链接
ls -la ~/.pi
```
