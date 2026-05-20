# weekly-release.ps1
# Run every Friday at 4pm via Task Scheduler.
# Reads DEV_CHANGES from work-log.html, builds release notes for the week,
# increments the minor version, and creates a GitHub release.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# ── 1. Get current latest version ─────────────────────────────────────────
$latestTag = git describe --tags --abbrev=0 2>&1
if (-not $latestTag -or $latestTag -notmatch '^v\d+\.\d+\.\d+$') {
    Write-Host "No valid semver tag found. Exiting."
    exit 1
}

# ── 2. Increment minor version ─────────────────────────────────────────────
$parts  = $latestTag.TrimStart('v') -split '\.'
$newTag = "v$($parts[0]).$([int]$parts[1] + 1).0"
Write-Host "Creating release $newTag (from $latestTag)"

# ── 3. Parse DEV_CHANGES from work-log.html ────────────────────────────────
# Matches lines like: { id:'20260513-001', date:'2026-05-13', desc:'...', areas:[1,2] },
$html       = Get-Content (Join-Path $root 'work-log.html') -Raw -Encoding UTF8
$pattern    = "\{ id:'(\d{8}-\d{3})', date:'(\d{4}-\d{2}-\d{2})', desc:'([^']+)', areas:\[([^\]]*)\] \},"
$devChanges = [regex]::Matches($html, $pattern)

Write-Host "Found $($devChanges.Count) total DEV_CHANGES entries"

# Date range: entries dated after the last tag's commit date up to today
$lastTagDate = git log -1 --format="%ai" $latestTag 2>&1
$sinceDate   = [datetime]::Parse(($lastTagDate -split ' ')[0])
$today       = (Get-Date).Date
Write-Host "Including changes after $($sinceDate.ToString('yyyy-MM-dd'))"

$weekChanges = $devChanges | Where-Object {
    $entryDate = [datetime]::Parse($_.Groups[2].Value)
    $entryDate -gt $sinceDate -and $entryDate -le $today
} | Sort-Object { $_.Groups[1].Value }

if (@($weekChanges).Count -eq 0) {
    Write-Host "No DEV_CHANGES entries since $latestTag. Skipping release."
    exit 0
}

Write-Host "Found $(@($weekChanges).Count) changes to include in release notes"

# ── 4. Build release notes ─────────────────────────────────────────────────
$lines  = [System.Collections.Generic.List[string]]::new()
$lines.Add("## $newTag — $(Get-Date -Format 'MMMM d, yyyy')")
$lines.Add("")

$byDate = $weekChanges | Group-Object { $_.Groups[2].Value }

foreach ($day in $byDate) {
    $d = [datetime]::Parse($day.Name)
    $lines.Add("**$($d.ToString('dddd, MMMM d'))**")
    foreach ($m in $day.Group) {
        $desc  = $m.Groups[3].Value
        $areas = $m.Groups[4].Value.Trim()
        if ($areas) {
            $lines.Add("- $desc *(tests: $areas)*")
        } else {
            $lines.Add("- $desc")
        }
    }
    $lines.Add("")
}

$notes = $lines -join "`n"
Write-Host "`nRelease notes preview:`n$notes`n"

# ── 5. Commit any pending changes ─────────────────────────────────────────
git add .
$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    git commit -m "Weekly release $newTag"
    Write-Host "Committed pending changes"
}

# ── 6. Tag, push, release ─────────────────────────────────────────────────
git tag $newTag
git push origin main
git push origin $newTag

# Write notes as UTF-8 without BOM (gh release requires clean UTF-8)
$notesFile = Join-Path $env:TEMP "release-notes-$newTag.md"
[System.IO.File]::WriteAllText($notesFile, $notes, [System.Text.UTF8Encoding]::new($false))

gh release create $newTag --title $newTag --notes-file $notesFile

Remove-Item $notesFile -ErrorAction SilentlyContinue
Write-Host "`nRelease $newTag created successfully."
