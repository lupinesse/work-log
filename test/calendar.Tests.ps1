#Requires -Modules Pester
<#
.SYNOPSIS
    Unit tests for the calendar helper logic in start-server.ps1.

.DESCRIPTION
    Tests the Add-ComRef dedup guard, the ?debug=1 query detection regex,
    and the locale-independent year-anchor date format used by Get-TodayMeetings.
    These tests exercise pure PowerShell logic and do not require Outlook.
#>

# Helper — builds a fresh (list, Add-ComRef) pair so each Describe gets isolation.
function New-ComRefTracker {
    $list = [System.Collections.Generic.List[object]]::new()
    $fn = {
        param($obj)
        if ($null -ne $obj -and -not $list.Contains($obj)) { $list.Add($obj) }
        return $obj
    }.GetNewClosure()
    return @{ Add = $fn; List = $list }
}

Describe 'Add-ComRef dedup guard' {
    It 'tracks a new object and returns it' {
        $t = New-ComRefTracker
        $obj = [object]::new()
        $result = & $t.Add $obj
        $result | Should Be $obj
        $t.List.Count | Should Be 1
    }

    It 'does not add the same object twice' {
        $t = New-ComRefTracker
        $obj = [object]::new()
        & $t.Add $obj | Out-Null
        & $t.Add $obj | Out-Null
        $t.List.Count | Should Be 1
    }

    It 'does not add null' {
        $t = New-ComRefTracker
        & $t.Add $null | Out-Null
        $t.List.Count | Should Be 0
    }

    It 'tracks distinct objects separately' {
        $t = New-ComRefTracker
        & $t.Add ([object]::new()) | Out-Null
        & $t.Add ([object]::new()) | Out-Null
        $t.List.Count | Should Be 2
    }
}

Describe 'Debug query detection' {
    # Pattern from the HTTP handler: detects ?debug=1 or &debug=1 in a query
    # string, but not debug=10 or similar partial matches.
    $debugPattern = '[?&]debug=1(&|$)'

    It 'matches ?debug=1' {
        ('?debug=1' -match $debugPattern) | Should Be $true
    }

    It 'matches &debug=1 at end of compound query' {
        ('?foo=bar&debug=1' -match $debugPattern) | Should Be $true
    }

    It 'matches debug=1 with a trailing parameter' {
        ('?debug=1&foo=bar' -match $debugPattern) | Should Be $true
    }

    It 'does not match debug=10' {
        ('?debug=10' -match $debugPattern) | Should Be $false
    }

    It 'does not match an empty query string' {
        ('' -match $debugPattern) | Should Be $false
    }

    It 'does not match unrelated parameters' {
        ('?foo=1&bar=2' -match $debugPattern) | Should Be $false
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
