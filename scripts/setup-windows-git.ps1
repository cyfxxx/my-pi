<#
    setup-windows-git.ps1 - Windows/exFAT 上让 git 能操作本仓库（每台新机器执行一次）

    对应 setup-external.sh 的 Windows 侧：那边装外部服务，这边修"git 读不了仓库"。

    ## 为什么需要它
    exFAT / FAT32 不记录文件属主，git 因此在每台新机器上拒绝操作仓库：
        fatal: detected dubious ownership in repository at '<repo>'
    而 **git 有意忽略仓库自身的 safe.directory 配置**（否则恶意仓库可自我放行），
    所以只能写用户级配置 ⇒ 无法随 U 盘携带，必须每台机器重做一次。

    注意 `vendor/pi` 是**独立 git 仓库**，需要单独登记；只登记外层会让
    check-isolation.sh / sync-upstream.sh 读不到它，并报出方向相反的
    "vendor/pi 有未提交的修改"（真实原因是读不了，不是有改动）。详见
    docs/operations/BUILD-PORTABILITY.md §4 与 §4.1。

    `scripts/build.sh` 在 clone vendor/pi 之后会自动登记它；本脚本用于**首次引导之前**
    （那时 vendor/pi 还不存在）以及体检。

    ## 用法
        powershell -ExecutionPolicy Bypass -File scripts\setup-windows-git.ps1
        powershell -ExecutionPolicy Bypass -File scripts\setup-windows-git.ps1 -RepoPath H:\my-pi
#>
[CmdletBinding()]
param(
    [string]$RepoPath
)

$ErrorActionPreference = 'Stop'

# ── 定位仓库 ──────────────────────────────────────────────────────────────
# 脚本位于 <repo>/scripts/，故 $PSScriptRoot 的父目录即仓库根。
if (-not $RepoPath) {
    $candidate = Split-Path -Parent $PSScriptRoot
    if (Test-Path (Join-Path $candidate '.git')) { $RepoPath = $candidate }
}
if (-not $RepoPath) {
    foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\$' })) {
        $p = Join-Path $d.Root 'my-pi'
        if (Test-Path (Join-Path $p '.git')) { $RepoPath = $p; break }
    }
}
if (-not $RepoPath) { throw "未找到仓库。请用 -RepoPath 指定（例如 -RepoPath H:\my-pi）" }

$repo = (Resolve-Path -LiteralPath $RepoPath).Path
Write-Host "仓库: $repo" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $repo '.git'))) { throw "$repo 不是 git 仓库" }

# ── 1. 登记 safe.directory（外层仓库 + vendor/pi）─────────────────────────
$targets = @(($repo -replace '\\', '/'))
$vendor = Join-Path $repo 'vendor\pi'
if (Test-Path (Join-Path $vendor '.git')) {
    $targets += ($vendor -replace '\\', '/')
}

Write-Host ""
Write-Host "[1/3] 登记 git safe.directory（用户级）..." -ForegroundColor Cyan
$before = @(& git config --global --get-all safe.directory 2>$null)
foreach ($t in $targets) {
    if ($before -notcontains $t) {
        & git config --global --add safe.directory $t
        if ($LASTEXITCODE -ne 0) { throw "git config 写入失败: $t" }
        Write-Host "      已添加 -> $t" -ForegroundColor Green
    }
    else {
        Write-Host "      已存在 -> $t" -ForegroundColor Green
    }
}
# 去重（保持首次出现顺序）
$all = @(& git config --global --get-all safe.directory 2>$null)
$uniq = @($all | Select-Object -Unique)
if ($uniq.Count -ne $all.Count) {
    & git config --global --unset-all safe.directory | Out-Null
    foreach ($d in $uniq) { & git config --global --add safe.directory $d }
    Write-Host "      （已去除重复项）"
}

# ── 2. 验证 git 现在能读仓库 ──────────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] 校验 git 可读性..." -ForegroundColor Cyan
& git -C $repo rev-parse --short HEAD | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git 仍无法访问 $repo" }
$head = (& git -C $repo rev-parse --short HEAD).Trim()
$dirty = @(& git -C $repo status --porcelain)
$state = if ($dirty.Count -gt 0) { "有 $($dirty.Count) 处未提交改动" } else { "干净" }
Write-Host "      HEAD=$head  工作树=$state" -ForegroundColor Green

if (Test-Path (Join-Path $vendor '.git')) {
    & git -C $vendor rev-parse --short HEAD | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $vhead = (& git -C $vendor rev-parse --short HEAD).Trim()
        Write-Host "      vendor/pi 可读，HEAD=$vhead" -ForegroundColor Green
    }
    else {
        Write-Host "      ✗ vendor/pi 仍不可读（见上方提示）" -ForegroundColor Red
    }
}

# ── 3. Node 版本与构建状态 ────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/3] 检查 Node.js 与构建状态..." -ForegroundColor Cyan

# 与 package.json engines 及 lib-vendor.sh 的 PI_NODE_MIN 保持一致
$minMajor = 22
$minMinor = 19
$nodeOk = $false
$nodeVer = '(未找到)'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = (& node -v) 2>$null
    if ($nodeVer -match '^v(\d+)\.(\d+)\.(\d+)') {
        $maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]
        # 逐段比较：只看主版本不够——上游用 Node 内置类型剥离直接跑 .ts（22.18+ 才默认开启）
        $nodeOk = ($maj -gt $minMajor) -or
                  (($maj -eq $minMajor) -and ($min -gt $minMinor)) -or
                  (($maj -eq $minMajor) -and ($min -eq $minMinor) -and ($pat -ge 0))
    }
}
if ($nodeOk) {
    Write-Host "      node $nodeVer  OK (>= $minMajor.$minMinor)" -ForegroundColor Green
}
else {
    Write-Host "      node $nodeVer  低于要求（需要 >= $minMajor.$minMinor）" -ForegroundColor Yellow
    Write-Host "      上游构建脚本用 Node 内置类型剥离直接运行 .ts，该能力 22.18+ 才默认开启；" -ForegroundColor Yellow
    Write-Host "      仅主版本为 22 并不够，构建中途会以 ERR_UNKNOWN_FILE_EXTENSION 失败。" -ForegroundColor Yellow
    Write-Host "      修复：nvm install $minMajor.$minMinor && nvm use $minMajor.$minMinor" -ForegroundColor Yellow
    Write-Host "            或从 https://nodejs.org 安装 Node.js >= $minMajor.$minMinor" -ForegroundColor Yellow
}

$cli = Join-Path $repo 'vendor\pi\packages\coding-agent\dist\cli.js'
$built = Test-Path $cli
if ($built) {
    Write-Host "      构建产物：已就绪（vendor/pi/.../dist/cli.js）" -ForegroundColor Green
}
else {
    Write-Host "      构建产物：缺失（vendor/pi 尚未构建）" -ForegroundColor Yellow
    Write-Host "      注意：npm install/ci **无法在 exFAT 上运行**（该卷不支持符号链接）。" -ForegroundColor Yellow
    Write-Host "            请在 NTFS 卷上构建后，把 vendor/ 与 node_modules/ 复制回来。" -ForegroundColor Yellow
    Write-Host "            详见 docs/operations/BUILD-PORTABILITY.md §2 与 §3。" -ForegroundColor Yellow
}

Write-Host ""
if ($built -and $nodeOk) {
    Write-Host "就绪。启动：  ./my-pi.sh        （git-bash 中）" -ForegroundColor Green
}
elseif ($built) {
    Write-Host "已构建，但需先修正 Node 版本（见上）。" -ForegroundColor Yellow
}
else {
    Write-Host "尚未构建（见上）。" -ForegroundColor Yellow
}
