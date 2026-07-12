@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul
if errorlevel 1 (
    echo [Dataset Studio] PowerShell 7 ^(pwsh^) was not found.
    echo Install PowerShell 7 and make sure it is available in PATH.
    pause
    exit /b 1
)

pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [Dataset Studio] Startup failed with exit code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
