@echo off
rem Dubbelklik om de dagelijkse JobWatcher-taak (08:00) te installeren.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-daily-task.ps1" %*
pause
