@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set PORT=3003
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo ========================================
echo   Interview Workbench Launcher
echo   Port: %PORT%
echo ========================================
echo.

rem ===== Check port =====
echo [1/3] Checking port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    set PID=%%a
    goto :found_pid
)
echo       Port %PORT% is free. Starting directly.
goto :start_server

:found_pid
echo       Port %PORT% is occupied by PID !PID!.
echo [2/3] Killing process !PID!...
taskkill /F /PID !PID! >nul 2>&1
if !errorlevel! equ 0 (
    echo       Process !PID! killed.
) else (
    echo       Warning: Failed to kill process, trying to start anyway...
)
timeout /t 1 /nobreak >nul

:start_server
echo [3/3] Starting HTTP server...
echo.
echo   Workbench: http://127.0.0.1:%PORT%/
echo.
echo   Press Ctrl+C to stop
echo ========================================
echo.

npx http-server -p %PORT% -c-1

endlocal