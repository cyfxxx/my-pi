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

## tmux

`tmux/tmux.conf`、`tmux/tmux-status.sh`、`tmux/status-loop.sh`：本机终端（Alacritty + tmux）
的键位/状态栏配置，迁移自 pi-tools `deploy/tmux/`。状态栏显示北京时间、1 分钟负载与内存
（按阈值着色）。

安装（把 `__MY_PI_ROOT__` 占位符替换为仓库绝对路径后写入 tmux 配置目录）：

```bash
mkdir -p ~/.config/tmux
sed "s#__MY_PI_ROOT__#$PWD#g" deploy/tmux/tmux.conf > ~/.config/tmux/tmux.conf
# tmux 3.2+ 读取 ~/.config/tmux/tmux.conf；旧版写入 ~/.tmux.conf
tmux source-file ~/.config/tmux/tmux.conf
```

状态文件（`tmux-status.txt`、`status-loop.lock`）落在
`${MY_PI_TMUX_STATE:-${XDG_CACHE_HOME:-$HOME/.cache}/my-pi-tmux}`，不写入仓库。

> tpm 插件（resurrect/continuum）需自行安装：`git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm`，
> 在 tmux 内按 `prefix + I` 安装插件。

## 未迁移项

- `systemd/pi-whisper.service`：语音能力按用户决定暂不迁移。
