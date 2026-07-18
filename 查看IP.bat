@echo off
chcp 65001 >nul
title 查找本机 IP

echo ==================================================
echo   本机 IP 地址 (发给队友用)
echo ==================================================
echo.
echo 你的电脑在局域网中的 IP:
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo   %%a
)

echo.
echo ==================================================
echo 队友手机/电脑 (连同一WiFi) 在浏览器打开:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo   http://%%a:3000/student.html
    echo   http://%%a:3000/driver.html
)
echo.
echo 注意: 你的电脑要保持双击"启动.bat"的状态
echo        (不要关掉那个黑色窗口)
echo ==================================================
echo.
pause
