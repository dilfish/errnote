@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 错题本

echo ============================================
echo   错题本
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js。
  echo 请先安装 Node.js 24 LTS：https://nodejs.org/zh-cn
  echo 安装时一路下一步即可，装完重新双击本文件。
  echo.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo [错误] Node.js 版本太低，需要 24 或更高。当前版本：
  node -v
  echo 请到 https://nodejs.org/zh-cn 下载最新的 LTS 版本。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖，需要联网，大约 1 分钟...
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    echo 如果 npm 官方源太慢，可以换成国内镜像：
    echo     npm config set registry https://registry.npmmirror.com
    pause
    exit /b 1
  )
)

if not exist "web\dist\index.html" (
  echo 正在构建页面...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [错误] 页面构建失败。
    pause
    exit /b 1
  )
)

echo.
echo 启动中，浏览器会自动打开 http://localhost:8787
echo 关闭这个窗口即可停止服务。
echo.
node server\index.ts --open

echo.
echo 服务已停止。
pause
