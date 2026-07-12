@echo off
start "" "%SystemRoot%\System32\wscript.exe" //nologo ^
    "%~dp0scripts\start-dev-hidden.vbs" %*
exit /b 0
