[CmdletBinding()]
param(
    [ValidateSet("auto", "cpu", "cuda")]
    [string]$Runtime = "auto",
    [switch]$CheckOnly,
    [switch]$SkipSync,
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
$HadUvProjectEnvironment = Test-Path Env:UV_PROJECT_ENVIRONMENT
$PreviousUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
$HadDatasetStudioRuntime = Test-Path Env:DATASET_STUDIO_RUNTIME
$PreviousDatasetStudioRuntime = $env:DATASET_STUDIO_RUNTIME
$HadDatasetStudioSourceRoot = Test-Path Env:DATASET_STUDIO_SOURCE_ROOT
$PreviousDatasetStudioSourceRoot = $env:DATASET_STUDIO_SOURCE_ROOT
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

function Test-NvidiaCudaDevice {
    $nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        return $false
    }

    try {
        $deviceIds = @(
            & $nvidiaSmi.Source "--query-gpu=index" "--format=csv,noheader,nounits" 2>$null
        )
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        return @($deviceIds | Where-Object { $_ -match "^\s*\d+\s*$" }).Count -gt 0
    } catch {
        return $false
    }
}

function Resolve-DevRuntime {
    if ($Runtime -eq "cpu") {
        return "cpu"
    }

    $cudaDeviceAvailable = Test-NvidiaCudaDevice
    if ($Runtime -eq "cuda" -and -not $cudaDeviceAvailable) {
        throw "显式请求了 CUDA Runtime，但没有检测到可用的 NVIDIA CUDA 设备。请检查驱动，或使用 -Runtime cpu。"
    }
    if ($cudaDeviceAvailable) {
        return "cuda"
    }
    return "cpu"
}

function Assert-BackendEntrypoints {
    param(
        [Parameter(Mandatory)]
        [string]$EnvironmentPath,
        [Parameter(Mandatory)]
        [string]$SelectedRuntime
    )

    $entrypoints = @("dataset-studio-api.exe", "dataset-studio-worker.exe")
    $missing = @(
        $entrypoints | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $EnvironmentPath "Scripts\$_") -PathType Leaf)
        }
    )
    if (-not $missing) {
        return
    }

    $detail = $missing -join ", "
    if ($SkipSync) {
        throw "Python $SelectedRuntime 环境缺少后端入口：$detail。当前使用了 -SkipSync，请先去掉该参数完成依赖同步。"
    }
    throw "Python $SelectedRuntime 环境缺少后端入口：$detail。请重新同步该运行时环境。"
}

function Assert-CudaRuntime {
    param([Parameter(Mandatory)][string]$EnvironmentPath)

    $python = Join-Path $EnvironmentPath "Scripts\python.exe"
    $probe = @'
import warnings

warnings.filterwarnings(
    "ignore",
    message=r"CUDA path could not be detected\..*",
    category=UserWarning,
)
import cupy as cp
import onnxruntime as ort

providers = ort.get_available_providers()
if "CUDAExecutionProvider" not in providers:
    raise SystemExit(
        "ONNX Runtime 未提供 CUDAExecutionProvider：" + ", ".join(providers)
    )
if cp.cuda.runtime.getDeviceCount() < 1:
    raise SystemExit("CuPy 没有检测到 CUDA 设备。")
with cp.cuda.Device(0):
    value = int(cp.arange(16, dtype=cp.int32).sum().get())
if value != 120:
    raise SystemExit(f"CuPy CUDA 探针结果异常：{value}")
'@

    & $python -c $probe
    Assert-LastExitCode -Step "CUDA Runtime 探测"
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
        $selectedRuntime = Resolve-DevRuntime
        $environmentPath = Join-Path $Backend ".venv-$selectedRuntime"
        $env:UV_PROJECT_ENVIRONMENT = $environmentPath
        $env:DATASET_STUDIO_RUNTIME = $selectedRuntime
        $env:DATASET_STUDIO_SOURCE_ROOT = $Root

        Write-Host "[Dataset Studio] Runtime：$selectedRuntime" -ForegroundColor Cyan
        Write-Host "[Dataset Studio] Python 环境：$environmentPath" -ForegroundColor DarkCyan

        if (-not $SkipSync) {
            Write-Host "[Dataset Studio] 检查前端依赖..." -ForegroundColor Cyan
            & pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
            Assert-LastExitCode -Step "前端依赖同步"

            Write-Host "[Dataset Studio] 同步 Python $selectedRuntime Runtime..." -ForegroundColor Cyan
            & uv sync --project $Backend --extra $selectedRuntime --all-groups --locked --exact
            Assert-LastExitCode -Step "Python $selectedRuntime 依赖同步"
        }

        Assert-BackendEntrypoints `
            -EnvironmentPath $environmentPath `
            -SelectedRuntime $selectedRuntime
        if ($selectedRuntime -eq "cuda") {
            Assert-CudaRuntime -EnvironmentPath $environmentPath
        }

        if ($CheckOnly) {
            Write-Host "[Dataset Studio] 开发环境检查通过（runtime=$selectedRuntime）。" -ForegroundColor Green
            return
        }

        Write-Host ""
        Write-Host "[Dataset Studio] 正在启动源码开发版..." -ForegroundColor Green
        Write-Host "首次启动需要编译桌面壳；前端修改仍会即时热更新。关闭窗口即可结束服务。"
        Write-Host ""

        # Windows 上被强制中断的 Rust 增量缓存偶尔会让后续链接永久等待。
        # 桌面壳很小，禁用其增量编译可换取更稳定的双击启动；Cargo 仍会复用完整构建产物。
        $env:CARGO_INCREMENTAL = "0"
        if ($selectedRuntime -eq "cuda") {
            & pnpm dev
        } else {
            & pnpm dev:cpu
        }
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
    if ($HadUvProjectEnvironment) {
        $env:UV_PROJECT_ENVIRONMENT = $PreviousUvProjectEnvironment
    } else {
        Remove-Item Env:UV_PROJECT_ENVIRONMENT -ErrorAction SilentlyContinue
    }
    if ($HadDatasetStudioRuntime) {
        $env:DATASET_STUDIO_RUNTIME = $PreviousDatasetStudioRuntime
    } else {
        Remove-Item Env:DATASET_STUDIO_RUNTIME -ErrorAction SilentlyContinue
    }
    if ($HadDatasetStudioSourceRoot) {
        $env:DATASET_STUDIO_SOURCE_ROOT = $PreviousDatasetStudioSourceRoot
    } else {
        Remove-Item Env:DATASET_STUDIO_SOURCE_ROOT -ErrorAction SilentlyContinue
    }

    if ($TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}

if ($ExitCode -ne 0) {
    exit $ExitCode
}
