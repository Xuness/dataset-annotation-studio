[CmdletBinding()]
param(
    [ValidateSet("cpu", "cuda")]
    [string]$Runtime = "cpu"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TargetTriple = (& rustc --print host-tuple).Trim()
if (-not $TargetTriple) {
    throw "无法读取 Rust host target triple。"
}

$Name = "dataset-studio-service-$TargetTriple"
$ExecutableSuffix = if ($IsWindows) { ".exe" } else { "" }
$ExecutableName = "$Name$ExecutableSuffix"
$EntryPoint = Join-Path $Root "backend/src/dataset_studio/entrypoints/service.py"
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

$PyInstallerArgs = @(
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
    $PyInstallerArgs += @("--collect-all", "cupy")
}
$PyInstallerArgs += $EntryPoint

& uv run --project (Join-Path $Root "backend") --extra $Runtime --exact pyinstaller @PyInstallerArgs

if ($LASTEXITCODE -ne 0) {
    throw "Python sidecar 构建失败，退出码：$LASTEXITCODE"
}

$Executable = Join-Path $Binaries $ExecutableName
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "未生成 sidecar：$Executable"
}

Write-Host "Sidecar ready: $Executable"
