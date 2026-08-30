@echo off
chcp 65001 >nul 2>nul
REM ========================================
REM DSH Skills Auto Enable - Auto Register (Windows)
REM ========================================
REM Usage: scripts\auto-register.cmd
REM ========================================
REM 委托给跨平台 Node 主脚本，统一逻辑（仅注册 dsh-skills-auto-enable 插件）
REM ========================================

setlocal

REM Check if node is available
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] node not found, please install Node.js
    exit /b 1
)

REM Delegate to the cross-platform Node master script
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%auto-register.js"
set "EXIT_CODE=%errorlevel%"

endlocal & exit /b %EXIT_CODE%
