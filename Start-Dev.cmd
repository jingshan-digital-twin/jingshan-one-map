@echo off
cd /d "%~dp0"
echo Web screen: http://127.0.0.1:5173/
echo Press Ctrl+C to stop the web app and API.
call npm.cmd run dev
if errorlevel 1 pause
