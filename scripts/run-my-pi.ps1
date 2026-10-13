<#
    run-my-pi.ps1 - 在 Windows 上启动 my-pi（自动使用可移动盘自带的工具链）

    ## 设计目标
    插到**任何** Windows 机器上都应直接可用，不依赖目标机器装过 Git 或 Node。

    ## 盘上布局（2026-10-13 起：工具链在仓库内，项目自包含）
        <仓库>\runtime\PortableGit\   便携版 Git（bash + git + 核心工具）
        <仓库>\runtime\node\          便携版 Node（>= 22.19）
        <仓库>\scripts\run-my-pi.ps1  本脚本
        <未加密分区>\VeraCrypt\       加密软件（**唯一必须留在明文分区的东西**）

    **工具链放在仓库内**，故与盘符无关：仓库能被找到，工具链就在。
    加密卷换盘符（本机 M:，别的机器可能 N:）也照常工作。

    **VeraCrypt 是唯一例外**，因为它与加密卷之间存在死锁：
    要挂载加密卷得先运行 VeraCrypt，而它若在加密卷里就需要先挂载才能拿到它。
    它是独立 GUI 程序，挂载不使用 bash/Node，所以该例外不牵连工具链。

    （历史布局 `<工具分区>:\runtime\` 仍受支持：查找顺序见 `Find-Runtime`，
      它最后会遍历所有盘符找 `<盘>:\runtime`。）

    ## 三个实测踩过的坑（都在这里修掉了）
    1) **不要用 `bash -l`（登录 shell）**。便携 Git 的 /etc/profile 会注入原安装机器的
       绝对路径（如 /d/App_X/Git/usr/bin），换机器后 `dirname`/`mkdir`/`tail` 全部
       command not found。正确做法：`bash -c` + 显式 PATH 指向便携工具链。
    2) **`bash` 这个名字可能被 WSL 抢走**。判断：`bash -c 'uname -s'` →
       `MINGW64_NT-*` 是 git-bash（认 /m/my-pi），`Linux` 是 WSL（认 /mnt/m/...）。
    3) **VeraCrypt 挂载的卷不出现在 `Get-Volume` 里**（实测 M: 缺失），但
       `Get-PSDrive` / `[IO.DriveInfo]` / `Test-Path` 都能看到。且 `Get-Volume` 可能
       含 0 容量幽灵卷（如 H:），对它 `Join-Path` 会抛 DriveNotFoundException。
       故统一改为"逐盘符 Test-Path + try/catch"探测。

    ## 用法
        powershell -ExecutionPolicy Bypass -File <仓库>\scripts\run-my-pi.ps1
        powershell -ExecutionPolicy Bypass -File <历史工具分区>\run-my-pi.ps1
        透传参数：  ... -File run-my-pi.ps1 --version
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PiArgs
)

# 注意：本脚本刻意不用 $ErrorActionPreference='Stop'。
# 探测多个盘符时，不存在的盘会抛错；Stop 会让循环中断（实测踩到，导致找不到仓库）。
$ErrorActionPreference = 'Continue'

function Get-DriveLetters {
    # 用 Get-PSDrive（能看到 VeraCrypt 卷），失败则退回枚举 A-Z
    $letters = @()
    try {
        $letters = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
                     Where-Object { $_.Name -match '^[A-Za-z]$' } |
                     ForEach-Object { $_.Name.ToUpper() })
    } catch { }
    if ($letters.Count -eq 0) {
        $letters = [char[]](65..90) | ForEach-Object { [string]$_ }
    }
    return $letters
}

function Find-Repo {
    # 1) 脚本若在仓库内（<repo>\scripts\），直接用父目录
    $psRoot = $PSScriptRoot
    if ($psRoot) {
        $cand = Split-Path -Parent $psRoot
        try { if (Test-Path -LiteralPath (Join-Path $cand 'my-pi.sh') -ErrorAction Stop) { return $cand } } catch { }
    }
    # 2) 逐盘符找 <letter>:\my-pi\my-pi.sh
    foreach ($L in (Get-DriveLetters)) {
        $p = "${L}:\my-pi"
        try {
            if (Test-Path -LiteralPath $p -ErrorAction Stop) {
                if (Test-Path -LiteralPath (Join-Path $p 'my-pi.sh') -ErrorAction Stop) { return $p }
            }
        } catch { }
    }
    # 3) 退一步：任意 <letter>:\ 下直接有 my-pi.sh（仓库被放在分区根）
    foreach ($L in (Get-DriveLetters)) {
        $p = "${L}:\"
        try { if (Test-Path -LiteralPath (Join-Path $p 'my-pi.sh') -ErrorAction Stop) { return $p } } catch { }
    }
    return $null
}

function Find-Runtime {
    param([string]$Repo)
    # 1) 优先**仓库内** <repo>\runtime\ —— 项目自包含、随项目移动（2026-10-13 起的主布局）
    #    放在最前是因为它是唯一"跟着项目走"的位置：只要仓库能被找到，工具链就在。
    if ($Repo) {
        foreach ($sub in @('runtime', '..\runtime')) {
            $p = Join-Path $Repo $sub
            try {
                if (Test-Path -LiteralPath (Join-Path $p 'PortableGit\bin\bash.exe') -ErrorAction Stop) {
                    return (Resolve-Path -LiteralPath $p).Path
                }
            } catch { }
        }
    }
    $letters = Get-DriveLetters
    # 2) 卷标 TOOLS 的分区（历史布局：工具链单独放在未加密分区；需 Get-Volume 可用）
    try {
        $byLabel = @(Get-Volume -ErrorAction SilentlyContinue |
                     Where-Object { $_.FileSystemLabel -eq 'TOOLS' -and $_.DriveLetter })
        foreach ($v in $byLabel) {
            $p = "$($v.DriveLetter):\runtime"
            try {
                if (Test-Path -LiteralPath (Join-Path $p 'PortableGit\bin\bash.exe') -ErrorAction Stop) { return $p }
            } catch { }
        }
    } catch { }
    # 3) 遍历所有盘符找 <盘>:\runtime
    foreach ($L in $letters) {
        $p = "${L}:\runtime"
        try {
            if (Test-Path -LiteralPath (Join-Path $p 'PortableGit\bin\bash.exe') -ErrorAction Stop) { return $p }
        } catch { }
    }
    return $null
}

$repo = Find-Repo
if (-not $repo) {
    throw "未找到 my-pi 仓库。若数据分区是 VeraCrypt 加密卷，请先用 VeraCrypt 挂载它（G:\VeraCrypt\ 里有便携版），再运行本脚本。"
}
$repo = (Resolve-Path -LiteralPath $repo).Path

$runtime = Find-Runtime -Repo $repo
$bashExe = $null
$nodeDir = $null
if ($runtime) {
    $bashExe = Join-Path $runtime 'PortableGit\bin\bash.exe'
    $nodeDir = Join-Path $runtime 'node'
}

if (-not $bashExe -or -not (Test-Path $bashExe)) {
    # 回退：本机安装的 Git
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $root = Split-Path -Parent (Split-Path -Parent $gitCmd.Source)
        $cand = Join-Path $root 'bin\bash.exe'
        if (Test-Path $cand) { $bashExe = $cand }
    }
    if (-not $bashExe) {
        throw "未找到 bash。请确认仓库内有 runtime\PortableGit\bin\bash.exe，或本机已安装 Git。"
    }
}

function ToMsys([string]$winPath) {
    $p = $winPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') { return '/' + $Matches[1].ToLower() + $Matches[2] }
    return $p
}

$repoMsys = ToMsys $repo
$runtimeMsys = if ($runtime) { ToMsys $runtime } else { $null }

Write-Host "仓库   : $repo" -ForegroundColor Cyan
Write-Host "bash   : $bashExe" -ForegroundColor DarkGray
if ($runtimeMsys) {
    Write-Host "工具链 : $runtime （盘内自带，不依赖目标机器）" -ForegroundColor DarkGray
} else {
    Write-Host "工具链 : 本机已安装的 Git（盘内未找到 runtime）" -ForegroundColor Yellow
}
if ($nodeDir -and (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $nv = (& (Join-Path $nodeDir 'node.exe') -v) 2>$null
    Write-Host "node   : $nodeDir （$nv）" -ForegroundColor DarkGray
} else {
    Write-Host "node   : 使用 PATH 上的 node（若低于 22.19 会失败）" -ForegroundColor Yellow
}

# 显式 PATH：便携 node + 便携 git 的 bin 目录
$pathParts = @()
if ($nodeDir -and (Test-Path $nodeDir)) { $pathParts += $nodeDir }
if ($runtimeMsys) {
    $pathParts += (ToMsys (Join-Path $runtime 'PortableGit\usr\bin'))
    $pathParts += (ToMsys (Join-Path $runtime 'PortableGit\mingw64\bin'))
    $pathParts += (ToMsys (Join-Path $runtime 'PortableGit\cmd'))
}
$pathMsys = ($pathParts -join ':')

$quoted = ($PiArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '

# ★ 把 node 绝对路径显式交给 supervisor（MY_PI_NODE）。
# 仅靠 PATH 不可靠：实测在便携 bash 里裸 `node` 会解析到宿主 PATH 上的旧版本
# （本机 D:\App_X\Node = 22.14.0），而运行期崩溃点是
#   zlib.createZstdDecompress is not a function   (undici 解 zstd 响应)
# 项目要求 Node >= 22.19。pi-supervisor.sh 会校验并采用 MY_PI_NODE。
if ($nodeDir -and (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $env:MY_PI_NODE = (Resolve-Path -LiteralPath (Join-Path $nodeDir 'node.exe')).Path
}
# 同时把便携 node 目录前置到 PATH，供 supervisor 之外的子进程使用
if ($nodeDir -and (Test-Path $nodeDir)) {
    $env:PATH = "$nodeDir;$env:PATH"
}

# ★ 关键：bash -c（非登录）+ 显式 PATH。不可用 -l，见文件头说明。
$inner = "cd '$repoMsys' && ./my-pi.sh $quoted"
if ($pathMsys) { $inner = "export PATH='$pathMsys':`$PATH; $inner" }

& $bashExe -c $inner
exit $LASTEXITCODE
