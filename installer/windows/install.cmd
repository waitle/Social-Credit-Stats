@echo off
rem 알리 주문 통계 설치 (더블클릭으로 실행)
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
