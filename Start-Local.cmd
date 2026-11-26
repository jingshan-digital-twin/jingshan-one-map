@echo off
rem Start the local Jingshan stack: PostgreSQL (55432), API (3001), Vite (5173).
setlocal
cd /d "%~dp0"

set "PGDATA_DIR=D:\jingshan-pg\data"
set "PGLOG=D:\jingshan-pg\server.log"
set "PGBIN=%~dp0.local\postgres\bin"

"%PGBIN%\pg_ctl.exe" -D "%PGDATA_DIR%" status >nul 2>&1
if errorlevel 1 (
  echo [1/3] starting PostgreSQL on 127.0.0.1:55432 ...
  "%PGBIN%\pg_ctl.exe" -D "%PGDATA_DIR%" -w -l "%PGLOG%" -o "-h 127.0.0.1 -p 55432" start
  if errorlevel 1 goto :fail
) else (
  echo [1/3] PostgreSQL already running
)

echo [2/3] starting API on 127.0.0.1:3001 ...
start "Jingshan API" cmd /k node --env-file=.env server/index.ts
timeout /t 4 /nobreak >nul

echo [3/3] starting Vite on http://127.0.0.1:5173/ ...
start "Jingshan Web" cmd /k node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
timeout /t 6 /nobreak >nul

start "" http://127.0.0.1:5173/
exit /b 0

:fail
echo.
echo PostgreSQL failed to start. See %PGLOG%
pause
exit /b 1
