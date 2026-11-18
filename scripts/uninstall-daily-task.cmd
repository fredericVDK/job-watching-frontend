@echo off
rem Verwijdert de dagelijkse JobWatcher-taak.
powershell -NoProfile -Command "Unregister-ScheduledTask -TaskName 'JobWatcher' -Confirm:$false; Write-Host 'Taak verwijderd.'"
pause
