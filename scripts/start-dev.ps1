[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [string]$FailurePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $Root "backend"
$DevMutex = $null
$OwnsDevMutex = $false
$TranscriptStarted = $false
$PreviousCargoIncremental = $env:CARGO_INCREMENTAL
$ExitCode = 0

$LogDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "DatasetAnnotationStudio\logs"
$LogPath = Join-Path $LogDirectory "dev-launch-$PID.log"

function Assert-Command {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "缺少命令 '$Name'。$Hint"
    }
}

function Assert-LastExitCode {
    param([Parameter(Mandatory)][string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step 失败，退出码：$LASTEXITCODE"
    }
}

function Enter-DevSession {
    $rootBytes = [Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())
    $rootHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($rootBytes))
    $mutexName = "Local\DatasetStudio.Dev.$($rootHash.Substring(0, 12))"

    $script:DevMutex = [Threading.Mutex]::new($false, $mutexName)
    try {
        $script:OwnsDevMutex = $script:DevMutex.WaitOne(0, $false)
    } catch [Threading.AbandonedMutexException] {
        $script:OwnsDevMutex = $true
    }

    if (-not $script:OwnsDevMutex) {
        throw "已有 Dataset Studio 开发会话正在启动或运行。请勿重复启动；若窗口迟迟没有出现，请先结束此前的开发会话后再试。"
    }
}

function Assert-DevPortsAvailable {
    $occupied = foreach ($port in 5173, 8765) {
        Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -First 1 LocalPort, OwningProcess
    }

    if (-not $occupied) {
        return
    }

    $descriptions = foreach ($connection in $occupied) {
        $ownerProcessId = [int]$connection.OwningProcess
        $owner = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
        $ownerName = if ($owner) { $owner.ProcessName } else { "未知进程" }
        "端口 $($connection.LocalPort)：$ownerName (PID $ownerProcessId)"
    }

    throw "开发端口已被占用，可能是此前的会话尚未退出：$($descriptions -join '；')"
}

function Write-FailureSummary {
    param([Parameter(Mandatory)][string]$Message)

    if ([string]::IsNullOrWhiteSpace($FailurePath)) {
        return
    }

    $failureDirectory = Split-Path -Parent $FailurePath
    if ($failureDirectory) {
        [IO.Directory]::CreateDirectory($failureDirectory) | Out-Null
    }

    $summary = "$Message`r`n`r`n启动日志：$LogPath"
    # FileSystemObject reads this hand-off file as UTF-16 so Chinese diagnostics survive the VBS bridge.
    [IO.File]::WriteAllText($FailurePath, $summary, [Text.UnicodeEncoding]::new($false, $true))
}

try {
    [IO.Directory]::CreateDirectory($LogDirectory) | Out-Null
    Start-Transcript -LiteralPath $LogPath -Force | Out-Null
    $TranscriptStarted = $true

    Assert-Command -Name "pnpm" -Hint "请安装 Node.js 与 pnpm。"
    Assert-Command -Name "uv" -Hint "请安装 uv。"
    Assert-Command -Name "cargo" -Hint "请安装 Rust 工具链。"
    Assert-Command -Name "rustc" -Hint "请安装 Rust 工具链。"

    try {
        $Host.UI.RawUI.WindowTitle = "Dataset Studio · 源码开发版"
    } catch {
        # 非交互式终端可能不支持设置标题，不影响启动。
    }

    if (-not $CheckOnly) {
        Enter-DevSession
        Assert-DevPortsAvailable
    }

    Push-Location $Root
    try {
        Write-Host "[Dataset Studio] 检查前端依赖..." -ForegroundColor Cyan
        & pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
        Assert-LastExitCode -Step "前端依赖同步"

        Write-Host "[Dataset Studio] 检查 Python 环境..." -ForegroundColor Cyan
        & uv sync --project $Backend --extra cpu --all-groups --locked
        Assert-LastExitCode -Step "Python 依赖同步"

        if ($CheckOnly) {
            Write-Host "[Dataset Studio] 开发环境检查通过。" -ForegroundColor Green
            return
        }

        Write-Host ""
        Write-Host "[Dataset Studio] 正在启动源码开发版..." -ForegroundColor Green
        Write-Host "首次启动需要编译桌面壳；前端修改仍会即时热更新。关闭窗口即可结束服务。"
        Write-Host ""

        # Windows 上被强制中断的 Rust 增量缓存偶尔会让后续链接永久等待。
        # 桌面壳很小，禁用其增量编译可换取更稳定的双击启动；Cargo 仍会复用完整构建产物。
        $env:CARGO_INCREMENTAL = "0"
        & pnpm dev
        Assert-LastExitCode -Step "Dataset Studio"
    } finally {
        Pop-Location
    }
} catch {
    $ExitCode = 1
    $message = $_.Exception.Message
    Write-FailureSummary -Message $message
    Write-Error "$message`n启动日志：$LogPath" -ErrorAction Continue
} finally {
    if ($OwnsDevMutex -and $null -ne $DevMutex) {
        $DevMutex.ReleaseMutex()
    }
    if ($null -ne $DevMutex) {
        $DevMutex.Dispose()
    }

    if ($null -eq $PreviousCargoIncremental) {
        Remove-Item Env:CARGO_INCREMENTAL -ErrorAction SilentlyContinue
    } else {
        $env:CARGO_INCREMENTAL = $PreviousCargoIncremental
    }

    if ($TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}

if ($ExitCode -ne 0) {
    exit $ExitCode
}
