@echo off
echo Running smoke tests...
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\playwright" (
    echo Installing Playwright...
    npm install playwright
    npx playwright install chromium
)

node smoke-tests.js
pause
