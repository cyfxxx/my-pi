# deploy — 可选部署产物

本目录放**可选**的系统级部署文件，不影响 `my-pi.sh` 正常运行。迁移自 pi-tools `deploy/`。

## systemd

- `systemd/pi-searxng.service`：把原生安装的 SearXNG（`scripts/setup-external.sh web` 装到 `/opt/searxng`）
  托管为 systemd 服务，开机自启、崩溃自动重启。

```bash
sudo cp deploy/systemd/pi-searxng.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-searxng
systemctl status pi-searxng        # journalctl -u pi-searxng 看日志
```

自定义安装路径时用 drop-in 覆盖（见 unit 内注释），或在 `ExecStart` 前设 `SEARXNG_HOME`。

> 注意：容器/PRoot/Termux 环境通常无 systemd，直接用 `scripts/setup-external.sh web`
> 启动（内部以 `setsid … &` 后台运行）即可。

## 未迁移项

- `tmux/`（`tmux.conf`、状态栏脚本）：属**每环境独立的终端配置**，与用户终端强相关，
  按项目"每环境独立配置不跨机覆盖"的约定不纳入本仓库；tmux 会话管理能力已由
  `custom/features/tmux` 提供。
- `systemd/pi-whisper.service`：语音能力按用户决定暂不迁移。
