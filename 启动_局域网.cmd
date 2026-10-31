@echo off
title LLMRPG AI跑团模拟器 - 局域网服务器模式
cd /d "D:\cache\project\LLMRPG_github_master"

rem 如存在便携版 Node，则优先使用
if exist "D:\cache\nodejs\npm.cmd" set "PATH=D:\cache\nodejs;%PATH%"

rem 端口占用预检
netstat -ano | findstr ":5174 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [提示] 端口 5174 已被占用（可能已启动过其它服务器窗口）。
  echo        请先关闭其它启动窗口，再重新运行本脚本。
  echo.
  pause
  exit /b
)

echo ============================================================
echo   LLMRPG AI跑团模拟器 - 局域网服务器模式
echo.
echo   本机访问:  http://127.0.0.1:5174/
echo   局域网内另一台电脑，用浏览器打开下面的地址：
node -e "const os=require('os');const n=os.networkInterfaces();const out=[];for(const k in n){for(const i of n[k]){if(i.family==='IPv4'&&!i.internal)out.push('   http://'+i.address+':5174/')}}if(out.length===0){console.log('   [未找到局域网IP，请检查本机网络连接]')}else{console.log(out.join('\n'))}"
echo.
echo   首次启动时 Windows 防火墙如弹出询问，请点【允许访问】
echo   （勾选“专用网络”更安全，不建议勾选公用网络）
echo   运行时请保持本窗口开着；关闭本窗口（或 Ctrl+C）即停止服务器
echo ============================================================
echo.

rem 如本地无依赖则先自动安装
if not exist "node_modules\.bin\vite.cmd" (
  echo [提示] 未找到 node_modules，开始自动安装（可能需要等待）...
  echo.
  call npm.cmd install
  echo.
  echo 依赖安装完成，继续启动...
  echo.
)

rem 监听 0.0.0.0：接受局域网内其他设备的访问
call npm.cmd run dev -- --port 5174 --host 0.0.0.0 --open

echo.
echo 服务器已停止运行，请关闭本窗口...
pause >nul