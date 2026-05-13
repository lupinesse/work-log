@echo off
:: Run this once to register the morning test task in Windows Task Scheduler
:: It will run smoke tests at 08:00 every weekday (Mon-Fri)

set TASK_NAME=WorkLogSmokeTests
set SCRIPT_PATH=%~dp0run-tests.bat

echo Registering scheduled task: %TASK_NAME%
echo Script: %SCRIPT_PATH%
echo Schedule: 08:00 Mon-Fri
echo.

schtasks /create /tn "%TASK_NAME%" /tr "\"%SCRIPT_PATH%\"" /sc WEEKLY /d MON,TUE,WED,THU,FRI /st 08:00 /f /rl HIGHEST

if %errorlevel%==0 (
    echo.
    echo Task registered successfully!
    echo To remove it later, run:  schtasks /delete /tn "%TASK_NAME%" /f
    echo To run it now manually:   schtasks /run /tn "%TASK_NAME%"
) else (
    echo.
    echo Failed to register task. Try running this as Administrator.
)

pause
