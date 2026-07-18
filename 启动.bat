@echo off
chcp 65001 >nul
title 南审校园公交系统 - 一键启动

echo ==================================================
echo   南审校园公交系统 - 后端服务
echo ==================================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo.
    echo 请先安装 Node.js: https://nodejs.org/
    echo 下载 LTS 版本, 双击安装包, 全部点下一步即可
    echo.
    echo 安装完成后, 重新双击本文件
    pause
    exit /b 1
)

echo [信息] Node.js 版本:
node -v
echo.

REM 第一次运行需要装依赖
if not exist "node_modules" (
    echo [信息] 首次运行, 正在安装依赖 (需 30 秒左右)...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
)

REM 自动放行 Windows 防火墙 3000 端口 (允许队友通过局域网访问)
REM 如果已存在规则, 会跳过; 需要管理员权限
echo [信息] 检查 Windows 防火墙 3000 端口规则...
netsh advfirewall firewall show rule name="Campus Bus 3000" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="Campus Bus 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
    if %errorlevel% neq 0 (
        echo [提示] 自动放行防火墙失败 (可能需要管理员权限)
        echo        队友可能连不上, 请手动: 控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙
        echo        或右键本文件 → 以管理员身份运行
    ) else (
        echo [信息] 已自动放行 3000 端口 (局域网队友可访问)
    )
) else (
    echo [信息] 3000 端口已放行
)
echo.

echo [信息] 正在启动后端服务...
echo.
echo 看到"已启动"后:
echo   - 你电脑: http://localhost:3000/student.html
echo   - 队友手机/电脑 (同一WiFi): http://你的IP:3000/student.html
echo   - 查 IP: 双击 查看IP.bat
echo.
echo 关闭此窗口 = 停止服务
echo ==================================================
echo.

node server.js

pause
