[CmdletBinding()]
param(
    [ValidateSet("cpu", "cuda")]
    [string]$Runtime = "cpu"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $Root "backend"
$EnvironmentPath = Join-Path $Backend ".venv-$Runtime"
$TargetTriple = (& rustc --print host-tuple).Trim()
if (-not $TargetTriple) {
    throw "无法读取 Rust host target triple。"
}

$Name = "dataset-studio-service-$TargetTriple"
$ExecutableSuffix = if ($IsWindows) { ".exe" } else { "" }
$ExecutableName = "$Name$ExecutableSuffix"
$EntryPoint = Join-Path $Backend "src/dataset_studio/entrypoints/service.py"
$Binaries = Join-Path $Root "src-tauri/binaries"
$WorkPath = Join-Path $Root "backend/build/pyinstaller"

$Running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -eq [System.IO.Path]::GetFullPath((Join-Path $Binaries $ExecutableName))
}
if ($Running) {
    $ProcessIds = ($Running.Id -join ", ")
    throw "无法重建仍在运行的 sidecar。请先关闭进程 PID: $ProcessIds"
}

New-Item -ItemType Directory -Force -Path $Binaries | Out-Null
New-Item -ItemType Directory -Force -Path $WorkPath | Out-Null

$PyInstallerArguments = @(
    "--noconfirm",
    "--clean",
    "--onefile",
    "--windowed",
    "--name", $Name,
    "--paths", (Join-Path $Root "backend/src"),
    "--collect-all", "openai_codex",
    "--collect-all", "codex_cli_bin",
    "--hidden-import", "onnx",
    "--hidden-import", "onnxruntime",
    "--distpath", $Binaries,
    "--workpath", $WorkPath,
    "--specpath", $WorkPath
)
if ($Runtime -eq "cuda") {
    $PyInstallerArguments += @(
        "--collect-all", "cupy",
        "--collect-all", "nvidia.nvimgcodec",
        "--collect-all", "nvidia.nvjpeg",
        "--collect-all", "nvidia.cuda_runtime",
        "--collect-all", "nvidia.cuda_nvrtc"
    )
}
$PyInstallerArguments += $EntryPoint

$HadUvProjectEnvironment = Test-Path Env:UV_PROJECT_ENVIRONMENT
$PreviousUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
$HadDatasetStudioRuntime = Test-Path Env:DATASET_STUDIO_RUNTIME
$PreviousDatasetStudioRuntime = $env:DATASET_STUDIO_RUNTIME
$BuildExitCode = 1
try {
    $env:UV_PROJECT_ENVIRONMENT = $EnvironmentPath
    $env:DATASET_STUDIO_RUNTIME = $Runtime
    Write-Host "Building $Runtime sidecar with environment: $EnvironmentPath"
    & uv run --project $Backend --extra $Runtime --all-groups --locked --exact pyinstaller @PyInstallerArguments
    $BuildExitCode = $LASTEXITCODE
} finally {
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
}

if ($BuildExitCode -ne 0) {
    throw "Python sidecar 构建失败，退出码：$BuildExitCode"
}

$Executable = Join-Path $Binaries $ExecutableName
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "未生成 sidecar：$Executable"
}

Write-Host "Sidecar ready: $Executable"
