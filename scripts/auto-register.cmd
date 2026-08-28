@echo off
chcp 65001 >nul 2>nul
REM ========================================
REM DSH Session Tag Manage - Auto Register (Windows)
REM ========================================
REM Usage: scripts\auto-register.cmd
REM ========================================

setlocal enabledelayedexpansion

REM Get project root directory (parent of scripts folder)
set "PROJECT_ROOT=%~dp0.."
REM Remove trailing backslash
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

REM Convert to absolute path
pushd "%PROJECT_ROOT%"
set "PROJECT_ROOT=%CD%"
popd

echo ========================================
echo DSH Session Tag Manage - Auto Register
echo ========================================
echo.
echo Project Root: %PROJECT_ROOT%
echo.

REM Check if dsh command is available
where dsh >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] dsh command not found, please install DeepSeek Harness
    echo Install: npm install -g @deepseek-ai/dsh
    exit /b 1
)

REM Check if plugin directories exist
if not exist "%PROJECT_ROOT%\packages\dsh-session-host" (
    echo [ERROR] Host plugin directory not found: packages\dsh-session-host
    exit /b 1
)

if not exist "%PROJECT_ROOT%\packages\dsh-session-client" (
    echo [ERROR] Client plugin directory not found: packages\dsh-session-client
    exit /b 1
)

REM Build plugins
echo [1/4] Building plugins...
cd /d "%PROJECT_ROOT%"
call pnpm build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    exit /b 1
)
echo [OK] Plugins built successfully
echo.

REM Install host plugin
echo [2/4] Installing host plugin...
dsh plugin --profile web add "%PROJECT_ROOT%\packages\dsh-session-host"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install host plugin
    exit /b 1
)
echo [OK] Host plugin installed successfully
echo.

REM Install client plugin
echo [3/4] Installing client plugin...
dsh plugin --profile web add "%PROJECT_ROOT%\packages\dsh-session-client"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install client plugin
    exit /b 1
)
echo [OK] Client plugin installed successfully
echo.

REM Completion message
echo [4/4] Registration completed
echo.
echo ========================================
echo Plugin registration successful!
echo ========================================
echo.
echo Start DSH:
echo   dsh web
echo.
echo Or use local development mode (host only):
echo   pnpm run dev
echo.
echo Note: Restart DSH after installation
echo ========================================

endlocal
