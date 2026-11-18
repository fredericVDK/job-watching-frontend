@echo off
rem Dubbelklik om de JobWatcher-app te openen op http://localhost:3000
cd /d "%~dp0"
if not exist node_modules (
  echo Eerste keer: packages installeren...
  call npm install
)
start "" http://localhost:3000
call npm run dev
