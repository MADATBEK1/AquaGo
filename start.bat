@echo off
chcp 65001 >nul
title AquaGo Server + Tunnel

echo.
echo  🌊  AquaGo ishga tushmoqda...
echo.

:: Eski node jarayonlarini to'xtatish (port 7474)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :7474 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Server ishga tushirilmoqda (tunnel ham avtomatik ochiladi)
start /B node "%~dp0server.js"

:: 3 soniya kutish (tunnel ochilishi uchun)
timeout /t 3 /nobreak >nul

:: Chrome app rejimida ochish
start "" chrome --app=http://localhost:7474 --window-size=430,850

echo.
echo  ✅ AquaGo ishga tushdi!
echo.
echo  📱 Bir xil WiFi:    http://192.168.x.x:7474
echo  🌐 Boshqa tarmoq:   Konsolda tunnel URL ko'rinadi
echo.
echo  Konsolni yopmaslik kerak - server ishlashi uchun!
echo.
pause
