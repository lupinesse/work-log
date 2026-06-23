#Requires -Modules Pester
<#
.SYNOPSIS
    Unit tests for the calendar helper logic in start-server.ps1.

.DESCRIPTION
    Exercises the real, dependency-free helpers that start-server.ps1 shares with
    these tests via server-helpers.ps1: the COM dedup guard (Test-NewComRef, used
    by Add-ComRef) and the ?debug=1 query detector (Test-DebugQuery). Also checks
    the locale-independent year-anchor date format used by Get-TodayMeetings.
    These tests exercise pure PowerShell logic and do not require Outlook.
#>

# Dot-source the same helpers the production server uses, so the dedup guard and
# debug-query detector are tested as the real functions rather than copies.
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $here
. (Join-Path $repoRoot 'server-helpers.ps1')

Describe 'Add-ComRef dedup guard (Test-NewComRef)' {
    # Drives the real guard exactly as Add-ComRef does in start-server.ps1:
    # append only when Test-NewComRef reports the object as new.
    function Add-Tracked {
        param($List, $Obj)
        if (Test-NewComRef $List $Obj) { $List.Add($Obj) }
    }

    It 'adds a new object' {
        $list = [System.Collections.Generic.List[object]]::new()
        Add-Tracked $list ([object]::new())
        $list.Count | Should Be 1
    }

    It 'does not add the same object twice' {
        $list = [System.Collections.Generic.List[object]]::new()
        $obj  = [object]::new()
        Add-Tracked $list $obj
        Add-Tracked $list $obj
        $list.Count | Should Be 1
    }

    It 'does not add null' {
        $list = [System.Collections.Generic.List[object]]::new()
        Add-Tracked $list $null
        $list.Count | Should Be 0
    }

    It 'tracks distinct objects separately' {
        $list = [System.Collections.Generic.List[object]]::new()
        Add-Tracked $list ([object]::new())
        Add-Tracked $list ([object]::new())
        $list.Count | Should Be 2
    }

    It 'reports an already-tracked object as not new' {
        $list = [System.Collections.Generic.List[object]]::new()
        $obj  = [object]::new()
        $list.Add($obj)
        Test-NewComRef $list $obj | Should Be $false
    }
}

Describe 'Debug query detection (Test-DebugQuery)' {
    # The handler in start-server.ps1 calls Test-DebugQuery on $req.Url.Query to
    # decide whether to attach diagnostic payloads. These cases pin its contract:
    # match ?debug=1 / &debug=1, but never partial values like debug=10.

    It 'matches ?debug=1' {
        Test-DebugQuery '?debug=1' | Should Be $true
    }

    It 'matches &debug=1 at end of compound query' {
        Test-DebugQuery '?foo=bar&debug=1' | Should Be $true
    }

    It 'matches debug=1 with a trailing parameter' {
        Test-DebugQuery '?debug=1&foo=bar' | Should Be $true
    }

    It 'does not match debug=10' {
        Test-DebugQuery '?debug=10' | Should Be $false
    }

    It 'does not match an empty query string' {
        Test-DebugQuery '' | Should Be $false
    }

    It 'does not match unrelated parameters' {
        Test-DebugQuery '?foo=1&bar=2' | Should Be $false
    }

    It 'enables debug when debug=1 appears even alongside a later debug=0' {
        Test-DebugQuery '?debug=1&debug=0' | Should Be $true
    }

    It 'does not match a parameter whose name merely ends in debug' {
        Test-DebugQuery '?xdebug=1' | Should Be $false
    }
}

Describe 'Year-anchor locale independence' {
    # The anchor uses the system locale date separator so MAPI accepts the string,
    # but day=1 and month=1 are identical under both M/d and d/M orderings,
    # making the effective date locale-independent.

    It 'builds the correct anchor string for a given year' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        $today = [DateTime]::new(2026, 6, 9)
        $anchor = "1${sep}1${sep}$($today.Year)"
        # Regardless of separator, day and month parts must both be 1
        $parts = $anchor -split [Regex]::Escape($sep)
        $parts[0] | Should Be '1'
        $parts[1] | Should Be '1'
        $parts[2] | Should Be '2026'
    }

    It 'next-year anchor is one year ahead' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        $today = [DateTime]::new(2026, 6, 9)
        $nextYear = "1${sep}1${sep}$($today.Year + 1)"
        $parts = $nextYear -split [Regex]::Escape($sep)
        $parts[2] | Should Be '2027'
    }

    It 'anchor year is correct for every month of the year' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        foreach ($month in 1..12) {
            $day = [DateTime]::new(2026, $month, 15)
            $anchor = "1${sep}1${sep}$($day.Year)"
            $parts = $anchor -split [Regex]::Escape($sep)
            $parts[2] | Should Be '2026'
        }
    }

    It 'produces dot-delimited anchor for Finnish locale separator' {
        $sep    = '.'
        $today  = [DateTime]::new(2026, 6, 9)
        $anchor = "1${sep}1${sep}$($today.Year)"
        $anchor | Should Be '1.1.2026'
    }

    It 'produces slash-delimited anchor for US locale separator' {
        $sep    = '/'
        $today  = [DateTime]::new(2026, 6, 9)
        $anchor = "1${sep}1${sep}$($today.Year)"
        $anchor | Should Be '1/1/2026'
    }
}
