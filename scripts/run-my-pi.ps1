<#
    run-my-pi.ps1 - 在 Windows 上启动 my-pi（自动用 git-bash + 正确的 Node）

    ## 为什么需要它
    本项目的启动脚本是 bash 脚本（`my-pi.sh`），而 Windows 终端（PowerShell / cmd）
    **不能直接执行 .sh**：
      * PowerShell 里敲 `./my-pi.sh` 不会跑 shebang，而是交给文件关联 —— 通常表现为
        弹窗、用记事本打开，或报"无法识别"，**不是脚本本身坏了**；
      * 必须显式用 bash 去跑：`bash my-pi.sh`。
    另外 git-bash 的 `bash` 与 WSL 的 `bash` 是两套东西（前者认 `/h/...`，后者完全不认），
    而 WSL 常常把 PATH 上的 `bash` 抢走 —— 用本脚本可避免这类歧义。

    ## 用法（在 Windows 终端里）
        powershell -ExecutionPolicy Bypass -File H:\my-pi\scripts\run-my-pi.ps1
        powershell -ExecutionPolicy Bypass -File H:\my-pi\scripts\run-my-pi.ps1 --version

    不带参数时会启动交互式 TUI（需要一个真正的终端窗口）。
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PiArgs
)

$ErrorActionPreference = 'Stop'

# ── 定位仓库（脚本在 <repo>/scripts/ 下）─────────────────────────────────
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo 'my-pi.sh'))) {
    throw "未在 $repo 找到 my-pi.sh（本脚本应位于仓库的 scripts/ 目录下）"
}

# ── 选择 bash：优先 git-bash，不要用 WSL 的 bash ──────────────────────────
$bashCandidates = @()
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    # 形如 <git>\cmd\git.exe -> <git>\bin\bash.exe
    $gitRoot = Split-Path -Parent (Split-Path -Parent $gitCmd.Source)
    $bashCandidates += (Join-Path $gitRoot 'bin\bash.exe')
}
$bashCandidates += @(
    'D:\App_X\Git\bin\bash.exe',
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
)
$bash = $bashCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $bash) {
    throw "未找到 git-bash（bash.exe）。请安装 Git for Windows；不要用 WSL 的 bash（本项目的脚本按 git-bash 路径习惯编写）。"
}

# ── 选择 Node：本机系统 Node 可能低于 22.19，优先用已知可用的便携版 ──────
$nodeDir = $null
foreach ($cand in @('D:\_node22\node-v22.23.3-win-x64')) {
    if (Test-Path (Join-Path $cand 'node.exe')) { $nodeDir = $cand; break }
}

# ── 组成在 git-bash 中执行的命令 ─────────────────────────────────────────
$drive = $repo.Substring(0, 1).ToLower()
$unixRepo = '/' + $drive + ($repo.Substring(2) -replace '\\', '/')

$quoted = ($PiArgs | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
}) -join ' '

$inner = "cd '$unixRepo' && ./my-pi.sh $quoted"

Write-Host "仓库 : $repo" -ForegroundColor Cyan
Write-Host "bash : $bash" -ForegroundColor DarkGray
if ($nodeDir) {
    Write-Host "node : $nodeDir （优先，满足 >= 22.19）" -ForegroundColor DarkGray
    $prefix = "export PATH='/$($nodeDir.Substring(0,1).ToLower())$($nodeDir.Substring(2) -replace '\\','/')':`$PATH; "
}
else {
    Write-Host "node : 使用 PATH 上的 node（若低于 22.19 会在构建/运行时失败）" -ForegroundColor Yellow
    $prefix = ""
}

# 交互式 TUI 需要真终端：这里用 -l（login shell）并继承当前终端
& $bash -lc "$prefix$inner"
exit $LASTEXITCODE
