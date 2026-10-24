@echo off
rem Double-click this file to start FinancialIQ. Close this window to stop it.
cd /d "%~dp0"
title FinancialIQ

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing the app's building blocks. This takes a minute or two...
  call npm install
)

if not exist .env.local (
  echo No .env.local file found. Copy .env.example to .env.local and paste your API keys into it.
  pause
  exit /b 1
)

echo Starting FinancialIQ at http://localhost:3000 ...
echo Keep this window open while you use the app. Close it to stop.
start "" http://localhost:3000
call npm run dev
pause
