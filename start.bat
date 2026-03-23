@echo off
chcp 65001 >nul
title AquaGo Server

echo.
echo  🌊  AquaGo ishga tushmoqda...
echo.

:: Eski node jarayonlarini to'xtatish (port 7474)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :7474 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Server ishga tushirilmoqda
start /B node "%~dp0server.js"

:: 2 soniya kutish
timeout /t 2 /nobreak >nul

:: Chrome app rejimida ochish (manzilsiz, ilovaga o'xshash)
start "" chrome --app=http://localhost:7474 --window-size=430,850

echo  ✅ AquaGo ishga tushdi!
echo.
echo  📱 Telefondan ochish: http://192.168.1.4:7474
echo.

