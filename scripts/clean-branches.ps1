<#
.SYNOPSIS
    Prunes local git branches that have already been merged into main.
.DESCRIPTION
    Fetches and prunes stale remote-tracking refs, then deletes any local
    branches whose tips are reachable from main. Safe: only removes branches
    that are fully merged, so no unmerged work can be lost.
.EXAMPLE
    npm run clean-branches
    pwsh -File scripts/clean-branches.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host 'Fetching and pruning remote-tracking refs...'
git fetch --prune

$merged = git branch --merged main |
    Where-Object { $_ -notmatch '^\*|main' } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' }

if (-not $merged) {
    Write-Host 'No merged branches to clean up.'
    exit 0
}

Write-Host "Deleting $($merged.Count) merged branch(es):"
foreach ($branch in $merged) {
    Write-Host "  - $branch"
    git branch -d $branch
}
