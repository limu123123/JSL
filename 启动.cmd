cd D:\cache\project\LLMRPG_github_master

@echo off
title LLMRPG AI跑团模拟器 - 本地开发服务器
cd /d "D:\cache\project\LLMRPG_github_master"

rem 如果存在便携版 Node，优先使用
if exist "D:\cache\nodejs\npm.cmd" set "PATH=D:\cache\nodejs;%PATH%"

echo ============================================================
echo   LLMRPG AI跑团模拟器（GitHub 原版 单人TRPG主持人）
echo.
echo   正在启动开发服务器，请稍候...
echo   浏览器将自动打开: http://127.0.0.1:5174/
echo   玩的时候请保持本窗口开启。
echo   关闭本窗口（或按 Ctrl+C）即可停止服务器。
echo ============================================================
echo.

rem 如果依赖未安装（例如刚从备份目录复制出来），先自动安装
if not exist "node_modules\.bin\vite.cmd" (
  echo [提示] 未找到 node_modules，开始自动安装依赖，请耐心等待...
  echo.
  call npm.cmd install
  echo.
  echo 依赖安装完成，继续启动...
  echo.
)

call npm.cmd run dev -- --port 5174 --host 127.0.0.1 --open

echo.
echo 服务器已停止。按任意键关闭本窗口...
pause >nul