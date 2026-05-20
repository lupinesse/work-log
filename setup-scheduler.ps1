# setup-scheduler.ps1
# Run once as Administrator to register the Friday 4pm weekly release task.

$scriptPath = Join-Path $PSScriptRoot 'weekly-release.ps1'

$action  = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek Friday `
    -At '16:00'

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
    -TaskName 'WorkLog Weekly Release' `
    -Action   $action `
    -Trigger  $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force

Write-Host "Task 'WorkLog Weekly Release' registered. Runs every Friday at 4pm."
