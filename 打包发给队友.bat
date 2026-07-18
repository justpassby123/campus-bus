@echo off
chcp 65001 >nul
title 打包项目给队友

echo ==================================================
echo   打包项目 (排除 node_modules)
echo ==================================================
echo.

cd /d "%~dp0"

REM 检查 PowerShell 是否可用
where powershell >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 系统缺少 PowerShell, 无法打包
    pause
    exit /b 1
)

REM 用 PowerShell 压缩 (排除 node_modules 和日志)
REM 注意: 不包含本脚本自身 (队友不需要再打包)
powershell -NoProfile -Command ^
  "Compress-Archive -Path '启动.bat','查看IP.bat','README.md','分享指南.md','package.json','package-lock.json','server.js','public' -DestinationPath '..\campus-bus-分享给队友.zip' -Force"

if %errorlevel% neq 0 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo [完成] 压缩包已生成: campus-bus-分享给队友.zip
echo 位置: 项目上级目录 (C:\Users\A\WorkBuddy\2026-07-11-12-04-15\)
echo.
echo 下一步: 把这个 zip 用 微信/钉钉/QQ 发给队友
echo         队友解压后双击"启动.bat"即可
echo.
pause
