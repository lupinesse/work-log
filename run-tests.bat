@echo off
cd /d "%~dp0"
set RESULT_FILE=%~dp0test-results.txt
set TIMESTAMP=%date% %time%

echo Work Log Smoke Tests > "%RESULT_FILE%"
echo Run: %TIMESTAMP% >> "%RESULT_FILE%"
echo. >> "%RESULT_FILE%"

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org >> "%RESULT_FILE%"
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Smoke tests FAILED: Node.js not found.', 'Work Log Tests', 'OK', 'Error')"
    exit /b 1
)

:: Install Playwright if needed
if not exist "node_modules\playwright" (
    echo Installing Playwright... >> "%RESULT_FILE%"
    call npm install playwright >> "%RESULT_FILE%" 2>&1
    call npx playwright install chromium >> "%RESULT_FILE%" 2>&1
)

:: Run tests, capture output
node smoke-tests.js >> "%RESULT_FILE%" 2>&1
set EXIT_CODE=%errorlevel%

:: Parse result from file
for /f "tokens=1,3 delims= " %%a in ('findstr /C:"passed  |" "%RESULT_FILE%"') do (
    set PASSED=%%a
    set FAILED=%%~b
)

if %EXIT_CODE%==0 (
    powershell -Command "$xml = '<toast><visual><binding template=\"ToastText02\"><text id=\"1\">Work Log Tests ✅</text><text id=\"2\">%PASSED% tests passed — all good!</text></binding></visual></toast>'; $toast = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; $xml2 = New-Object Windows.Data.Xml.Dom.XmlDocument; $xml2.LoadXml($xml); $t = [Windows.UI.Notifications.ToastNotification]::new($xml2); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Work Log').Show($t)" >nul 2>&1
    if errorlevel 1 (
        echo. >> "%RESULT_FILE%"
        echo ALL TESTS PASSED >> "%RESULT_FILE%"
    )
) else (
    echo. >> "%RESULT_FILE%"
    echo TESTS FAILED - opening results... >> "%RESULT_FILE%"
    start notepad "%RESULT_FILE%"
    powershell -Command "$xml = '<toast><visual><binding template=\"ToastText02\"><text id=\"1\">Work Log Tests ❌</text><text id=\"2\">%FAILED% tests failed — check test-results.txt</text></binding></visual></toast>'; $toast = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; $xml2 = New-Object Windows.Data.Xml.Dom.XmlDocument; $xml2.LoadXml($xml); $t = [Windows.UI.Notifications.ToastNotification]::new($xml2); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Work Log').Show($t)" >nul 2>&1
    if errorlevel 1 (
        echo Results saved to test-results.txt
    )
)

exit /b %EXIT_CODE%
