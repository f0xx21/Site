@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск сайта на http://localhost:3000
echo Закройте это окно, чтобы остановить сервер.
echo.
npx --yes serve . -p 3000
