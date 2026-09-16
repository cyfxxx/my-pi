# deploy/ — 部署配置

部署相关的配置文件和脚本。

## 目录结构

```
deploy/
├── systemd/                    # Systemd 服务配置
│   ├── pi-searxng.service      # SearXNG 搜索引擎服务
│   └── pi-whisper.service      # Whisper 语音转写服务
└── tmux/                       # tmux 配置
    ├── tmux.conf               # tmux 配置文件
    ├── tmux-status.sh          # 状态栏脚本
    ├── tmux-status.txt         # 状态栏文本模板
    ├── status-loop.sh          # 状态循环脚本
    └── status-loop.lock        # 状态循环锁文件
```

## 部署方式

| 方式 | 用途 |
|------|------|
| Systemd | 用于 SearXNG 和 Whisper 服务 |
| tmux | 用于后台任务和长任务管理 |

## 相关文档

- [scripts/deploy/](../scripts/README.md)
- [安装脚本](../scripts/install/)
- [部署指南](../docs/DEPLOYMENT-GUIDE.md)
