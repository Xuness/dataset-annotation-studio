[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RootPrefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$RemovedBytes = 0L

function Get-SafeProjectPath {
    param([Parameter(Mandatory)][string]$Path)

    $FullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $FullPath.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理项目目录以外的路径：$FullPath"
    }
    return $FullPath
}

function Remove-SafeTree {
    param([Parameter(Mandatory)][string]$Path)

    $SafePath = Get-SafeProjectPath -Path $Path
    if (-not (Test-Path -LiteralPath $SafePath -PathType Container)) {
        return
    }
    $Files = @(Get-ChildItem -LiteralPath $SafePath -Force -Recurse -File -ErrorAction SilentlyContinue)
    $Size = if ($Files.Count) {
        ($Files | Measure-Object -Property Length -Sum).Sum
    } else {
        0L
    }
    if ($PSCmdlet.ShouldProcess($SafePath, "删除生成目录")) {
        Remove-Item -LiteralPath $SafePath -Recurse -Force
        $script:RemovedBytes += ($Size ?? 0)
        Write-Host "已清理目录：$SafePath"
    }
}

function Remove-SafeFile {
    param([Parameter(Mandatory)][string]$Path)

    $SafePath = Get-SafeProjectPath -Path $Path
    if (-not (Test-Path -LiteralPath $SafePath -PathType Leaf)) {
        return
    }
    $Size = (Get-Item -LiteralPath $SafePath).Length
    if ($PSCmdlet.ShouldProcess($SafePath, "删除生成文件")) {
        Remove-Item -LiteralPath $SafePath -Force
        $script:RemovedBytes += $Size
        Write-Host "已清理文件：$SafePath"
    }
}

$GeneratedDirectories = @(
    (Join-Path $Root "src-tauri/target"),
    (Join-Path $Root "src-tauri/gen"),
    (Join-Path $Root "backend/build"),
    (Join-Path $Root "backend/.pytest_cache"),
    (Join-Path $Root "backend/.ruff_cache"),
    (Join-Path $Root "frontend/dist"),
    (Join-Path $Root "frontend/node_modules/.tmp"),
    (Join-Path $Root "frontend/node_modules/.vite"),
    (Join-Path $Root "frontend/node_modules/.vite-temp"),
    (Join-Path $Root ".pytest_cache"),
    (Join-Path $Root ".ruff_cache")
)

foreach ($Directory in $GeneratedDirectories) {
    Remove-SafeTree -Path $Directory
}

$SourceRoots = @(
    (Join-Path $Root "backend/src"),
    (Join-Path $Root "backend/tests")
)
foreach ($SourceRoot in $SourceRoots) {
    if (Test-Path -LiteralPath $SourceRoot -PathType Container) {
        Get-ChildItem -LiteralPath $SourceRoot -Recurse -Directory -Filter "__pycache__" |
            Sort-Object FullName -Descending |
            ForEach-Object { Remove-SafeTree -Path $_.FullName }
    }
}

Get-ChildItem -LiteralPath $Root -File -Filter ".codex-*.log" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-SafeFile -Path $_.FullName }

$Binaries = Join-Path $Root "src-tauri/binaries"
if (Test-Path -LiteralPath $Binaries -PathType Container) {
    Get-ChildItem -LiteralPath $Binaries -File -Filter "dataset-studio-service-*" |
        ForEach-Object { Remove-SafeFile -Path $_.FullName }
}

Get-ChildItem -LiteralPath (Join-Path $Root "frontend") -File -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-SafeFile -Path $_.FullName }

Write-Host ("清理完成，共释放约 {0:N2} GiB。" -f ($RemovedBytes / 1GB)) -ForegroundColor Green
