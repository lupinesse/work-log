#Requires -Modules Pester
<#
.SYNOPSIS
    Unit tests for the calendar helper logic in start-server.ps1.

.DESCRIPTION
    Exercises the real, dependency-free helpers that start-server.ps1 shares with
    these tests via server-helpers.ps1: the COM dedup guard (Test-NewComRef, used
    by Add-ComRef), the ?debug=1 query detector (Test-DebugQuery), the
    locale-independent year-anchor date format, and the calendar collection rules
    that decide which meetings reach the browser.

    The collection helpers take Outlook items, but only ever read properties off
    whatever they are given, so the mocks below stand in for AppointmentItem,
    RecurrencePattern, and MAPIFolder. No Outlook installation is needed.
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

Describe 'Year-anchor locale independence (Get-YearAnchor)' {
    # Get-YearAnchor builds the Jan-1 boundary string MAPI filters use. Day and
    # month are both 1, so only the year varies and the value is identical under
    # both d/M and M/d orderings — that is what makes the anchor locale-independent.

    It 'builds 1-sep-1-sep-year using the current culture separator' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        $parts = (Get-YearAnchor -Year 2026) -split [Regex]::Escape($sep)
        # Regardless of separator, day and month parts must both be 1
        $parts[0] | Should Be '1'
        $parts[1] | Should Be '1'
        $parts[2] | Should Be '2026'
    }

    It 'advances the year by one for the next-year anchor' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        ((Get-YearAnchor -Year 2027) -split [Regex]::Escape($sep))[2] | Should Be '2027'
    }

    It 'keeps the year part correct for every month of the year' {
        $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
        foreach ($month in 1..12) {
            $day = [DateTime]::new(2026, $month, 15)
            ((Get-YearAnchor -Year $day.Year) -split [Regex]::Escape($sep))[2] | Should Be '2026'
        }
    }

    It 'produces a dot-delimited anchor for the Finnish locale separator' {
        Get-YearAnchor -Year 2026 -Separator '.' | Should Be '1.1.2026'
    }

    It 'produces a slash-delimited anchor for the US locale separator' {
        Get-YearAnchor -Year 2026 -Separator '/' | Should Be '1/1/2026'
    }
}

# ── Outlook mocks ─────────────────────────────────────────────────────────────
# The collection helpers only read properties and call documented methods, so a
# PSCustomObject with the right shape stands in for a COM item. Building them
# through these three factories keeps the cases below to the detail that matters.

function New-MockAppointment {
    param(
        $Subject,
        $Start,
        $End,
        $GlobalId    = $null,
        $Location    = '',
        $Body        = '',
        $IsRecurring = $false
    )
    return [pscustomobject]@{
        Subject             = $Subject
        Start               = $Start
        End                 = $End
        GlobalAppointmentID = $GlobalId
        Location            = $Location
        Body                = $Body
        IsRecurring         = $IsRecurring
    }
}

# $Slots maps an ISO-8601 ('o') start time to the occurrence Outlook returns for
# it; any other time throws, exactly as GetOccurrence does for an occurrence that
# was moved or deleted. $Exceptions holds @{ Deleted; AppointmentItem } entries.
function New-MockRecurringMaster {
    param(
        $Subject,
        $Start,
        $End,
        $GlobalId   = $null,
        [hashtable]$Slots = @{},
        $Exceptions = @()
    )
    $master  = New-MockAppointment $Subject $Start $End $GlobalId '' '' $true
    $pattern = [pscustomobject]@{ Slots = $Slots; Exceptions = $Exceptions }
    $pattern | Add-Member -MemberType ScriptMethod -Name GetOccurrence -Value {
        param($When)
        $key = $When.ToString('o')
        if ($this.Slots.Contains($key)) { return $this.Slots[$key] }
        throw [System.Exception]::new('The occurrence does not exist')
    }
    $master | Add-Member -MemberType NoteProperty -Name Pattern -Value $pattern
    $master | Add-Member -MemberType ScriptMethod -Name GetRecurrencePattern -Value { return $this.Pattern }
    return $master
}

function New-MockFolder {
    param(
        [string]$Name,
        [int]$DefaultItemType,   # 1 = olAppointmentItem
        $Folders = @()
    )
    return [pscustomobject]@{ Name = $Name; DefaultItemType = $DefaultItemType; Folders = $Folders }
}

function New-MockDiagnostics {
    return [ordered]@{ pass2Error = ''; exceptionsScanned = 0 }
}

Describe 'Day membership (Test-MeetingOnDate)' {
    # The collector used to compare start dates for equality, which silently
    # dropped every meeting that overlaps the day without starting on it.
    $day = [DateTime]'2026-09-01'

    It 'accepts a meeting wholly inside the day' {
        Test-MeetingOnDate ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 10:00') $day | Should Be $true
    }

    It 'accepts a multi-day event that started on an earlier day' {
        Test-MeetingOnDate ([DateTime]'2026-08-31') ([DateTime]'2026-09-03') $day | Should Be $true
    }

    It 'accepts a meeting that began yesterday evening and runs past midnight' {
        Test-MeetingOnDate ([DateTime]'2026-08-31 23:00') ([DateTime]'2026-09-01 01:00') $day | Should Be $true
    }

    It 'accepts an all-day event covering exactly the day' {
        Test-MeetingOnDate ([DateTime]'2026-09-01') ([DateTime]'2026-09-02') $day | Should Be $true
    }

    It 'rejects a meeting that ends exactly at midnight on the day' {
        Test-MeetingOnDate ([DateTime]'2026-08-31 23:00') ([DateTime]'2026-09-01 00:00') $day | Should Be $false
    }

    It 'accepts a meeting starting exactly at midnight on the day' {
        Test-MeetingOnDate ([DateTime]'2026-09-01 00:00') ([DateTime]'2026-09-01 00:30') $day | Should Be $true
    }

    It 'accepts a zero-length appointment on the day' {
        Test-MeetingOnDate ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 09:00') $day | Should Be $true
    }

    It 'treats a missing end time as zero length' {
        Test-MeetingOnDate ([DateTime]'2026-09-01 09:00') $null $day | Should Be $true
    }

    It 'rejects a meeting on the next day' {
        Test-MeetingOnDate ([DateTime]'2026-09-02 09:00') ([DateTime]'2026-09-02 10:00') $day | Should Be $false
    }

    It 'rejects a meeting that ended on an earlier day' {
        Test-MeetingOnDate ([DateTime]'2026-08-30 09:00') ([DateTime]'2026-08-30 10:00') $day | Should Be $false
    }

    It 'reports an unreadable start as not on the day' {
        Test-MeetingOnDate $null $null $day | Should Be $false
    }

    It 'ignores the time of day on the reference date' {
        Test-MeetingOnDate ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 10:00') ([DateTime]'2026-09-01 17:45') | Should Be $true
    }
}

Describe 'Scan control (Get-ScanAction)' {
    # Regression: a single item whose Start could not be read used to break the
    # Pass 1 loop, hiding every meeting after it in the folder.
    $day = [DateTime]'2026-09-01'

    It 'skips an item with an unreadable start rather than stopping the scan' {
        Get-ScanAction $null $null $day $true | Should Be 'skip'
    }

    It 'takes an item on the day' {
        Get-ScanAction ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 10:00') $day $true | Should Be 'take'
    }

    It 'takes a multi-day item that overlaps the day' {
        Get-ScanAction ([DateTime]'2026-08-30') ([DateTime]'2026-09-02') $day $true | Should Be 'take'
    }

    It 'stops on a sorted collection once items start on a later day' {
        Get-ScanAction ([DateTime]'2026-09-02 09:00') ([DateTime]'2026-09-02 10:00') $day $true | Should Be 'stop'
    }

    It 'keeps walking an unsorted collection past a later-day item' {
        Get-ScanAction ([DateTime]'2026-09-02 09:00') ([DateTime]'2026-09-02 10:00') $day $false | Should Be 'skip'
    }

    It 'skips an item from an earlier day without stopping' {
        Get-ScanAction ([DateTime]'2026-08-01 09:00') ([DateTime]'2026-08-01 10:00') $day $true | Should Be 'skip'
    }
}

Describe 'Subject normalisation (Get-MeetingSubject)' {
    # Outlook returns $null — not an error — for an untitled appointment, and the
    # browser drops any meeting whose subject is not a string.

    It 'substitutes a placeholder for a null subject' {
        Get-MeetingSubject $null | Should Be '(no title)'
    }

    It 'substitutes a placeholder for an empty subject' {
        Get-MeetingSubject '' | Should Be '(no title)'
    }

    It 'substitutes a placeholder for a whitespace-only subject' {
        Get-MeetingSubject '   ' | Should Be '(no title)'
    }

    It 'trims surrounding whitespace' {
        Get-MeetingSubject '  Sprint review  ' | Should Be 'Sprint review'
    }

    It 'leaves an ordinary subject unchanged' {
        Get-MeetingSubject 'Sprint review' | Should Be 'Sprint review'
    }
}

Describe 'Meeting identity (Get-MeetingKey)' {
    $start = [DateTime]'2026-09-01 09:00'
    $end   = [DateTime]'2026-09-01 09:15'

    It 'gives the same meeting in two accounts one key' {
        $a = Get-MeetingKey 'GID-1' 'Standup' $start $end
        $b = Get-MeetingKey 'GID-1' 'Standup' $start $end
        $a | Should Be $b
    }

    It 'keeps two different meetings apart even when title and time match' {
        # Regression: keying on subject and start alone collapsed genuinely
        # different meetings that happened to share both.
        $a = Get-MeetingKey 'GID-1' 'Standup' $start $end
        $b = Get-MeetingKey 'GID-2' 'Standup' $start $end
        ($a -eq $b) | Should Be $false
    }

    It 'keeps two occurrences of one series apart' {
        $a = Get-MeetingKey 'GID-1' 'Standup' $start $end
        $b = Get-MeetingKey 'GID-1' 'Standup' $start.AddDays(1) $end.AddDays(1)
        ($a -eq $b) | Should Be $false
    }

    It 'separates meetings that share a start but not an end' {
        $a = Get-MeetingKey $null 'Standup' $start $end
        $b = Get-MeetingKey $null 'Standup' $start $end.AddHours(2)
        ($a -eq $b) | Should Be $false
    }

    It 'falls back to the subject when no global id is available' {
        $a = Get-MeetingKey $null 'Standup' $start $end
        $b = Get-MeetingKey ''    'STANDUP' $start $end
        $a | Should Be $b
    }

    It 'tolerates missing start and end times' {
        Get-MeetingKey $null 'Standup' $null $null | Should Be 'subj:standup||'
    }
}

Describe 'Teams link extraction (Get-TeamsJoinUrl)' {

    It 'finds a join URL in surrounding text' {
        Get-TeamsJoinUrl 'Click https://teams.microsoft.com/l/meetup-join/abc to join' |
            Should Be 'https://teams.microsoft.com/l/meetup-join/abc'
    }

    It 'decodes HTML-escaped ampersands in the query string' {
        Get-TeamsJoinUrl 'https://teams.microsoft.com/l/x?a=1&amp;b=2' |
            Should Be 'https://teams.microsoft.com/l/x?a=1&b=2'
    }

    It 'returns nothing when the text holds no Teams link' {
        Get-TeamsJoinUrl 'Meeting room 3, second floor' | Should BeNullOrEmpty
    }

    It 'returns nothing for empty text' {
        Get-TeamsJoinUrl '' | Should BeNullOrEmpty
    }
}

Describe 'Look-back window clamping (Get-CalendarLookBackYears)' {
    # User configuration, so an out-of-range value is clamped rather than fatal.

    It 'passes an in-range value through' {
        Get-CalendarLookBackYears -Requested 3 | Should Be 3
    }

    It 'clamps a negative value to zero' {
        Get-CalendarLookBackYears -Requested -5 | Should Be 0
    }

    It 'clamps an excessive value to twenty' {
        Get-CalendarLookBackYears -Requested 99 | Should Be 20
    }

    It 'allows zero, meaning the current year only' {
        Get-CalendarLookBackYears -Requested 0 | Should Be 0
    }
}

Describe 'Guarded property reads (Read-ComProperty and Read-ComDate)' {
    # Any property read can throw on a damaged item or a store that does not
    # expose it; one bad appointment must not abort a folder scan.

    It 'reads a present property' {
        Read-ComProperty (New-MockAppointment 'Standup' $null $null) 'Subject' | Should Be 'Standup'
    }

    It 'returns nothing for a property the item does not have' {
        Read-ComProperty ([pscustomobject]@{ Subject = 'Standup' }) 'Location' | Should BeNullOrEmpty
    }

    It 'returns nothing when the property read throws' {
        $item = [pscustomobject]@{}
        $item | Add-Member -MemberType ScriptProperty -Name Subject -Value { throw 'COM error' }
        Read-ComProperty $item 'Subject' | Should BeNullOrEmpty
    }

    It 'returns nothing for a null item' {
        Read-ComProperty $null 'Subject' | Should BeNullOrEmpty
    }

    It 'reads a date property as a DateTime' {
        Read-ComDate (New-MockAppointment 'x' ([DateTime]'2026-09-01 09:00') $null) 'Start' |
            Should Be ([DateTime]'2026-09-01 09:00')
    }

    It 'converts a date-like string to a DateTime' {
        Read-ComDate ([pscustomobject]@{ Start = '2026-09-01T09:00:00' }) 'Start' |
            Should Be ([DateTime]'2026-09-01 09:00')
    }

    It 'returns nothing for a value that is not a date' {
        Read-ComDate ([pscustomobject]@{ Start = 'not a date' }) 'Start' | Should BeNullOrEmpty
    }
}

Describe 'Meeting record shape (New-MeetingRecord)' {
    $start = [DateTime]'2026-09-01 09:00'
    $end   = [DateTime]'2026-09-01 09:30'

    It 'emits round-trip formatted start and end times' {
        $record = New-MeetingRecord (New-MockAppointment 'Standup' $start $end) 'work@example.com'
        $record.start | Should Be $start.ToString('o')
        $record.end   | Should Be $end.ToString('o')
    }

    It 'carries the account label through' {
        (New-MeetingRecord (New-MockAppointment 'Standup' $start $end) 'work@example.com').account |
            Should Be 'work@example.com'
    }

    It 'emits a placeholder subject for an untitled meeting' {
        # Regression: a null subject reached the browser as JSON null, which the
        # meeting validator rejected, so untitled meetings vanished silently.
        (New-MeetingRecord (New-MockAppointment $null $start $end) 'acct').subject | Should Be '(no title)'
    }

    It 'extracts the Teams link from the body' {
        $item = New-MockAppointment 'Standup' $start $end $null 'Teams' 'join https://teams.microsoft.com/l/x'
        (New-MeetingRecord $item 'acct').joinUrl | Should Be 'https://teams.microsoft.com/l/x'
    }

    It 'falls back to the start time when the end cannot be read' {
        (New-MeetingRecord (New-MockAppointment 'Standup' $start $null) 'acct').end | Should Be $start.ToString('o')
    }

    It 'throws for an item with no readable start' {
        { New-MeetingRecord (New-MockAppointment 'Standup' $null $null) 'acct' } | Should Throw
    }
}

Describe 'Collecting one meeting (Add-MeetingForDay)' {
    $day   = [DateTime]'2026-09-01'
    $start = [DateTime]'2026-09-01 09:00'
    $end   = [DateTime]'2026-09-01 09:15'

    It 'adds a meeting on the day' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        Add-MeetingForDay (New-MockAppointment 'Standup' $start $end 'G1') 'acct' $day $seen $sink | Should Be $true
        $sink.Count | Should Be 1
    }

    It 'does not add the same meeting twice' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        $item = New-MockAppointment 'Standup' $start $end 'G1'
        $null = Add-MeetingForDay $item 'acct' $day $seen $sink
        Add-MeetingForDay $item 'acct' $day $seen $sink | Should Be $false
        $sink.Count | Should Be 1
    }

    It 'collapses the copy of one meeting held in a second account' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        $null = Add-MeetingForDay (New-MockAppointment 'Standup' $start $end 'G1') 'work' $day $seen $sink
        Add-MeetingForDay (New-MockAppointment 'Standup' $start $end 'G1') 'personal' $day $seen $sink | Should Be $false
        $sink.Count | Should Be 1
    }

    It 'keeps two different meetings that share a title and a time' {
        # Regression: these collapsed into one row before global ids were used.
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        $null = Add-MeetingForDay (New-MockAppointment 'Review' $start $end 'G1') 'work' $day $seen $sink
        Add-MeetingForDay (New-MockAppointment 'Review' $start $end 'G2') 'personal' $day $seen $sink | Should Be $true
        $sink.Count | Should Be 2
    }

    It 'keeps an untitled meeting' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        Add-MeetingForDay (New-MockAppointment $null $start $end 'G1') 'acct' $day $seen $sink | Should Be $true
        $sink[0].subject | Should Be '(no title)'
    }

    It 'adds a multi-day event that started on an earlier day' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        $offsite = New-MockAppointment 'Offsite' ([DateTime]'2026-08-31') ([DateTime]'2026-09-03') 'G1'
        Add-MeetingForDay $offsite 'acct' $day $seen $sink | Should Be $true
    }

    It 'ignores a meeting on another day' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        $tomorrow = New-MockAppointment 'Later' $start.AddDays(1) $end.AddDays(1) 'G1'
        Add-MeetingForDay $tomorrow 'acct' $day $seen $sink | Should Be $false
        $sink.Count | Should Be 0
    }

    It 'ignores an item whose start cannot be read' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new()
        Add-MeetingForDay (New-MockAppointment 'Broken' $null $null) 'acct' $day $seen $sink | Should Be $false
        $sink.Count | Should Be 0
    }
}

Describe 'Recurring occurrences (Add-RecurringOccurrence)' {
    # A series' master item sits on the day of its first occurrence, so today's
    # instance has to be probed for. GetOccurrence finds the one in its original
    # slot; anything moved or deleted only shows up in Exceptions.
    $day         = [DateTime]'2026-09-01'
    $masterStart = [DateTime]'2023-01-05 10:00'
    $masterEnd   = [DateTime]'2023-01-05 10:30'

    It 'collects the occurrence sitting in its usual slot' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $occurrence = New-MockAppointment 'Weekly 1:1' ([DateTime]'2026-09-01 10:00') ([DateTime]'2026-09-01 10:30') 'S1'
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' @{ '2026-09-01T10:00:00.0000000' = $occurrence }
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 1
        $sink.Count | Should Be 1
    }

    It 'collects an occurrence that was moved to a different time today' {
        # Regression: GetOccurrence throws for a moved occurrence, so probing the
        # original slot alone lost every rescheduled meeting.
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $moved     = New-MockAppointment 'Weekly 1:1' ([DateTime]'2026-09-01 14:00') ([DateTime]'2026-09-01 14:30') 'S1'
        $exception = [pscustomobject]@{ Deleted = $false; AppointmentItem = $moved }
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' @{} @($exception)
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 1
        $sink[0].start | Should Be ([DateTime]'2026-09-01 14:00').ToString('o')
    }

    It 'collects an occurrence moved into today from another day' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $movedIn   = New-MockAppointment 'Weekly 1:1' ([DateTime]'2026-09-01 08:00') ([DateTime]'2026-09-01 08:30') 'S1'
        $elsewhere = New-MockAppointment 'Weekly 1:1' ([DateTime]'2026-09-08 10:00') ([DateTime]'2026-09-08 10:30') 'S1'
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' @{} @(
            [pscustomobject]@{ Deleted = $false; AppointmentItem = $movedIn },
            [pscustomobject]@{ Deleted = $false; AppointmentItem = $elsewhere }
        )
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 1
        $sink.Count | Should Be 1
    }

    It 'skips an occurrence that was cancelled for today' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' @{} @(
            [pscustomobject]@{ Deleted = $true; AppointmentItem = $null }
        )
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 0
        $sink.Count | Should Be 0
    }

    It 'adds an occurrence once when both probes return it' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $occurrence = New-MockAppointment 'Weekly 1:1' ([DateTime]'2026-09-01 10:00') ([DateTime]'2026-09-01 10:30') 'S1'
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' `
            @{ '2026-09-01T10:00:00.0000000' = $occurrence } `
            @([pscustomobject]@{ Deleted = $false; AppointmentItem = $occurrence })
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 1
        $sink.Count | Should Be 1
    }

    It 'adds nothing for a series with no occurrence today' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $master = New-MockRecurringMaster 'Monthly' $masterStart $masterEnd 'S2'
        Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg | Should Be 0
    }

    It 'records a failed pattern read in the diagnostics instead of throwing' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $broken = New-MockAppointment 'Broken series' $masterStart $masterEnd 'S9'
        $broken | Add-Member -MemberType ScriptMethod -Name GetRecurrencePattern -Value { throw 'MAPI failure' }
        Add-RecurringOccurrence $broken 'acct' $day $seen $sink $dbg | Should Be 0
        $dbg.pass2Error | Should Match 'Broken series'
    }

    It 'counts the exceptions it scanned' {
        $seen = @{}; $sink = [System.Collections.Generic.List[object]]::new(); $dbg = New-MockDiagnostics
        $master = New-MockRecurringMaster 'Weekly 1:1' $masterStart $masterEnd 'S1' @{} @(
            [pscustomobject]@{ Deleted = $true; AppointmentItem = $null },
            [pscustomobject]@{ Deleted = $true; AppointmentItem = $null }
        )
        $null = Add-RecurringOccurrence $master 'acct' $day $seen $sink $dbg
        $dbg.exceptionsScanned | Should Be 2
    }
}

Describe 'Finding calendars (Get-CalendarSubFolder)' {
    # Regression: the walk used to look only one level below the mailbox root, so
    # a secondary calendar nested inside the default Calendar folder — and every
    # meeting in it — never reached the strip.
    function New-MockStoreTree {
        $deep     = New-MockFolder 'Deep team calendar' 1
        $team     = New-MockFolder 'Team' 1 @($deep)
        $calendar = New-MockFolder 'Calendar' 1 @($team)
        $inbox    = New-MockFolder 'Inbox' 0
        return New-MockFolder 'Root' 0 @($inbox, $calendar)
    }

    It 'finds calendars nested below the top level' {
        $names = (Get-CalendarSubFolder -Parent (New-MockStoreTree)) | ForEach-Object { $_.Name }
        ($names -join ',') | Should Be 'Calendar,Team,Deep team calendar'
    }

    It 'ignores folders that do not hold appointments' {
        $names = (Get-CalendarSubFolder -Parent (New-MockStoreTree)) | ForEach-Object { $_.Name }
        ($names -contains 'Inbox') | Should Be $false
    }

    It 'stops at the requested depth' {
        $names = (Get-CalendarSubFolder -Parent (New-MockStoreTree) -MaxDepth 2) | ForEach-Object { $_.Name }
        ($names -join ',') | Should Be 'Calendar,Team'
    }

    It 'returns nothing for a folder with no children' {
        (Get-CalendarSubFolder -Parent (New-MockFolder 'Leaf' 1)).Count | Should Be 0
    }

    It 'returns nothing for a null parent' {
        (Get-CalendarSubFolder -Parent $null).Count | Should Be 0
    }

    It 'skips a folder whose children cannot be read' {
        (Get-CalendarSubFolder -Parent ([pscustomobject]@{ Name = 'Unreadable' })).Count | Should Be 0
    }

    It 'reports every acquired object to the tracking callback' {
        # The live server passes Add-ComRef here so Outlook references are released.
        $tracked = [System.Collections.Generic.List[object]]::new()
        $null = Get-CalendarSubFolder -Parent (New-MockStoreTree) -Track { param($ComObject) $tracked.Add($ComObject); $ComObject }
        ($tracked.Count -gt 0) | Should Be $true
    }
}
