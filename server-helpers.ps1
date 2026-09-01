<#
.SYNOPSIS
    Pure, side-effect-free helpers shared by start-server.ps1 and its Pester tests.

.DESCRIPTION
    These functions hold no Outlook/COM or HttpListener state, so they can be
    dot-sourced from start-server.ps1 (production use) and from
    test/calendar.Tests.ps1 (so the tests exercise the real logic instead of a
    hand-rolled copy). Keeping them here gives the HTTP debug-query detector, the
    COM dedup guard, and the calendar collection rules — which day a meeting
    belongs to, when a folder scan may stop early, how meetings are deduplicated
    across accounts, and how subjects and Teams links are normalised — a single,
    tested source of truth.

    The file only declares functions and emits nothing when loaded, so it is safe
    to dot-source at the top level and to inject into the calendar runspace via
    AddScript without disturbing that runspace's return value.
#>

function Test-DebugQuery {
    <#
    .SYNOPSIS
        Tests whether an HTTP query string requests debug output.

    .DESCRIPTION
        Returns $true when the query contains ?debug=1 or &debug=1, and $false
        for partial matches such as debug=10 or an empty query string.

    .PARAMETER Query
        The raw query string from the request URL, e.g. '?debug=1&foo=bar'.

    .OUTPUTS
        System.Boolean

    .EXAMPLE
        Test-DebugQuery '?debug=1'        # -> $true

    .EXAMPLE
        Test-DebugQuery '?debug=10'       # -> $false
    #>
    [OutputType([bool])]
    param(
        [string]$Query
    )
    Set-StrictMode -Version Latest
    # Match debug=1 only as a whole query parameter: preceded by ? or & (the
    # [?&] class) and followed by another & or end-of-string (the (&|$) group).
    # This rejects partial values like debug=10 and names like xdebug=1.
    return [bool]($Query -match '[?&]debug=1(&|$)')
}

function Test-NewComRef {
    <#
    .SYNOPSIS
        Tests whether a COM object should be added to the tracking list.

    .DESCRIPTION
        The dedup guard used by Add-ComRef inside Get-TodayMeetings: an object is
        "new" when it is non-null and not already tracked. Centralising it here
        keeps the guard's contract in one tested place; start-server.ps1 injects
        this file into its calendar runspace so the live COM path calls the same
        function rather than a copy.

    .PARAMETER List
        The list of already-tracked COM references.

    .PARAMETER ComObject
        The candidate COM object to test.

    .OUTPUTS
        System.Boolean

    .EXAMPLE
        $tracked = [System.Collections.Generic.List[object]]::new()
        Test-NewComRef $tracked $obj      # -> $true the first time, $false after it is added
    #>
    [OutputType([bool])]
    param(
        [System.Collections.Generic.List[object]]$List,
        $ComObject
    )
    Set-StrictMode -Version Latest
    # Fail loudly on misuse: a missing tracker list is a programming error, not a
    # condition to silently absorb. A $null $ComObject is valid input and is simply
    # reported as not-new, so the caller skips adding it.
    if ($null -eq $List) { throw 'Test-NewComRef requires a non-null -List.' }
    return [bool]($null -ne $ComObject -and -not $List.Contains($ComObject))
}

function Get-YearAnchor {
    <#
    .SYNOPSIS
        Builds a locale-independent Jan-1 year-boundary anchor for Outlook MAPI.

    .DESCRIPTION
        Returns "1{sep}1{sep}{Year}". Day and month are both 1, so the value is
        identical under d/M and M/d orderings and only the year varies — that is
        what makes the anchor locale-independent. MAPI Restrict/Find filters parse
        the string with the system locale, so the separator defaults to the
        current culture's; Get-TodayMeetings passes the live separator explicitly.

    .PARAMETER Year
        The four-digit calendar year for the anchor.

    .PARAMETER Separator
        The date separator to embed. Defaults to the current culture's
        DateTimeFormat.DateSeparator so live MAPI filters match Outlook's locale;
        tests pass an explicit separator to assert locale independence.

    .OUTPUTS
        System.String

    .EXAMPLE
        Get-YearAnchor 2026 '.'      # -> '1.1.2026'

    .EXAMPLE
        Get-YearAnchor 2026 '/'      # -> '1/1/2026'
    #>
    [OutputType([string])]
    param(
        [int]$Year,
        [string]$Separator = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
    )
    Set-StrictMode -Version Latest
    return "1${Separator}1${Separator}${Year}"
}

function Get-CalendarLookBackYears {
    <#
    .SYNOPSIS
        Clamps the configured recurring-series look-back window to a sane range.

    .DESCRIPTION
        Get-TodayMeetings widens its Pass 2 MAPI window backwards in whole years
        so that recurring series which began in an earlier year are still probed
        for an occurrence today. The window is user configuration
        ($CalendarLookBackYears in config.local.ps1), so an out-of-range value is
        clamped rather than fatal: a negative value would move the lower anchor
        past the upper one and return nothing, and an unbounded value would make
        every request scan the entire calendar history.

    .PARAMETER Requested
        The configured number of years to look back. Values below 0 clamp to 0
        (current year only) and values above 20 clamp to 20.

    .OUTPUTS
        System.Int32

    .EXAMPLE
        Get-CalendarLookBackYears -Requested 3     # -> 3

    .EXAMPLE
        Get-CalendarLookBackYears -Requested -5    # -> 0
    #>
    [OutputType([int])]
    param(
        [int]$Requested = 3
    )
    Set-StrictMode -Version Latest
    if ($Requested -lt 0)  { return 0 }
    if ($Requested -gt 20) { return 20 }
    return $Requested
}

function Test-MeetingOnDate {
    <#
    .SYNOPSIS
        Tests whether a meeting's time span overlaps a given calendar day.

    .DESCRIPTION
        Replaces a start-date equality check, which silently excluded every
        meeting that overlaps today without starting today: multi-day all-day
        events, and meetings that begin before midnight and run into the day.

        The comparison is half-open — [day 00:00, next day 00:00) — so a meeting
        ending exactly at midnight belongs to the day before, and one starting
        exactly at midnight belongs to the day after.

    .PARAMETER Start
        The meeting's start time. $null (an unreadable COM Start property) is
        reported as not on the day, since there is nothing to compare.

    .PARAMETER End
        The meeting's end time. $null is treated as equal to Start.

    .PARAMETER Day
        Any DateTime on the day of interest; only its date part is used.

    .OUTPUTS
        System.Boolean

    .EXAMPLE
        # A meeting wholly inside the day
        Test-MeetingOnDate ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 10:00') ([DateTime]'2026-09-01')
        # -> $true

    .EXAMPLE
        # A three-day event that started yesterday still counts today
        Test-MeetingOnDate ([DateTime]'2026-08-31') ([DateTime]'2026-09-03') ([DateTime]'2026-09-01')
        # -> $true
    #>
    [OutputType([bool])]
    param(
        [AllowNull()][object]$Start,
        [AllowNull()][object]$End,
        [Parameter(Mandatory)][DateTime]$Day
    )
    Set-StrictMode -Version Latest
    if ($null -eq $Start) { return $false }
    $startAt  = [DateTime]$Start
    $endAt    = if ($null -eq $End) { $startAt } else { [DateTime]$End }
    $dayStart = $Day.Date
    $dayEnd   = $dayStart.AddDays(1)
    # A zero-length appointment (and a malformed one whose end precedes its
    # start) has no span to overlap with, so only its start time is considered.
    if ($endAt -le $startAt) { return ($startAt -ge $dayStart -and $startAt -lt $dayEnd) }
    return ($startAt -lt $dayEnd -and $endAt -gt $dayStart)
}

function Get-ScanAction {
    <#
    .SYNOPSIS
        Decides what a calendar-folder scan should do with the item it is on.

    .DESCRIPTION
        Returns one of three verbs, keeping the scan loop in Get-TodayMeetings
        free of date logic:

        - 'take' — the item overlaps the requested day; collect it.
        - 'stop' — only on a start-sorted collection, when the item begins on a
                   later day. Nothing after it in the sort order can overlap the
                   day, so the walk can exit early.
        - 'skip' — anything else, including an item whose Start could not be
                   read. An unreadable item must never end the scan: one corrupt
                   appointment would otherwise hide every later meeting in the
                   folder.

    .PARAMETER Start
        The item's start time, or $null when the COM property could not be read.

    .PARAMETER End
        The item's end time, or $null when it could not be read.

    .PARAMETER Day
        Any DateTime on the day being collected; only its date part is used.

    .PARAMETER Sorted
        True when the collection is sorted ascending by [Start], which is what
        makes the early 'stop' exit safe. False forces a full walk.

    .OUTPUTS
        System.String — 'take', 'skip', or 'stop'.

    .EXAMPLE
        Get-ScanAction ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 10:00') ([DateTime]'2026-09-01') $true
        # -> 'take'

    .EXAMPLE
        Get-ScanAction $null $null ([DateTime]'2026-09-01') $true
        # -> 'skip'   (never 'stop' — a bad item must not truncate the scan)
    #>
    [OutputType([string])]
    param(
        [AllowNull()][object]$Start,
        [AllowNull()][object]$End,
        [Parameter(Mandatory)][DateTime]$Day,
        [bool]$Sorted
    )
    Set-StrictMode -Version Latest
    if ($null -eq $Start) { return 'skip' }
    if (Test-MeetingOnDate -Start $Start -End $End -Day $Day) { return 'take' }
    if ($Sorted -and ([DateTime]$Start).Date -gt $Day.Date) { return 'stop' }
    return 'skip'
}

function Get-MeetingSubject {
    <#
    .SYNOPSIS
        Normalises an Outlook appointment subject to a non-empty string.

    .DESCRIPTION
        Outlook returns $null — not an error — for an appointment saved without a
        title, and the browser drops any meeting whose subject is not a string.
        Untitled meetings therefore disappeared from the strip entirely. Every
        subject read from COM goes through this function so the API always emits
        a string.

    .PARAMETER Raw
        The raw Subject value read from the COM item.

    .OUTPUTS
        System.String — the trimmed subject, or '(no title)'.

    .EXAMPLE
        Get-MeetingSubject '  Sprint review  '   # -> 'Sprint review'

    .EXAMPLE
        Get-MeetingSubject $null                 # -> '(no title)'
    #>
    [OutputType([string])]
    param(
        [AllowNull()][object]$Raw
    )
    Set-StrictMode -Version Latest
    # One return path for the placeholder, so the string it substitutes is written
    # once. It cannot be shared with the browser's own copy in
    # normalizeCalendarMeeting — that lives in a separate JS bundle — so the two
    # are kept in step by the tests on either side.
    $text = if ($null -eq $Raw) { '' } else { ([string]$Raw).Trim() }
    if ($text.Length -eq 0) { return '(no title)' }
    return $text
}

function Get-MeetingKey {
    <#
    .SYNOPSIS
        Builds the deduplication key for one collected meeting.

    .DESCRIPTION
        Get-TodayMeetings reads the same day from several folders and in two
        passes, so it needs a key that collapses genuine duplicates without
        collapsing distinct meetings.

        GlobalAppointmentID is identical for the same meeting in every invited
        account's calendar, which is exactly the duplicate worth removing. It is
        also shared by every occurrence of a recurring series, so the start and
        end times stay in the key — that keeps separate occurrences apart, and
        keeps two different meetings that merely share a title and start time
        apart as well. Subject is only the identity of last resort, for stores
        that do not expose a global id.

    .PARAMETER GlobalId
        The item's GlobalAppointmentID, or $null when unavailable.

    .PARAMETER Subject
        The item's subject, used only when GlobalId is absent. Compared
        case-insensitively.

    .PARAMETER Start
        The item's start time, or $null.

    .PARAMETER End
        The item's end time, or $null.

    .OUTPUTS
        System.String

    .EXAMPLE
        Get-MeetingKey 'ABC123' 'Standup' ([DateTime]'2026-09-01 09:00') ([DateTime]'2026-09-01 09:15')
        # -> 'gid:ABC123|2026-09-01T09:00:00.0000000|2026-09-01T09:15:00.0000000'
    #>
    [OutputType([string])]
    param(
        [AllowNull()][object]$GlobalId,
        [AllowNull()][object]$Subject,
        [AllowNull()][object]$Start,
        [AllowNull()][object]$End
    )
    Set-StrictMode -Version Latest
    $identity = if ($null -ne $GlobalId -and -not [string]::IsNullOrWhiteSpace([string]$GlobalId)) {
        'gid:' + ([string]$GlobalId)
    } else {
        'subj:' + (Get-MeetingSubject $Subject).ToLowerInvariant()
    }
    $startPart = if ($null -eq $Start) { '' } else { ([DateTime]$Start).ToString('o') }
    $endPart   = if ($null -eq $End)   { '' } else { ([DateTime]$End).ToString('o') }
    return "$identity|$startPart|$endPart"
}

function Get-TeamsJoinUrl {
    <#
    .SYNOPSIS
        Extracts the Teams join URL from an appointment's location and body.

    .DESCRIPTION
        Returns the first Microsoft Teams meeting URL found in the supplied text,
        with HTML-escaped ampersands decoded so the link works when clicked.
        Returns $null when the text holds no Teams link, which is what the API
        emits for meetings without one.

    .PARAMETER Text
        Text to search — Get-TodayMeetings passes the appointment's location and
        body joined together.

    .OUTPUTS
        System.String — the join URL, or $null.

    .EXAMPLE
        Get-TeamsJoinUrl 'Join at https://teams.microsoft.com/l/meetup-join/x?a=1&amp;b=2'
        # -> 'https://teams.microsoft.com/l/meetup-join/x?a=1&b=2'
    #>
    [OutputType([string])]
    param(
        [AllowNull()][string]$Text
    )
    Set-StrictMode -Version Latest
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    if ($Text -match 'https://teams\.microsoft\.com/[^\s"<>]+') {
        return ($Matches[0] -replace '&amp;', '&')
    }
    return $null
}

# ── Outlook item readers ──────────────────────────────────────────────────────
# The functions below take Outlook COM objects, but only ever read properties and
# call documented methods on whatever they are handed. That makes them
# duck-typed: the Pester suite drives them with plain PSCustomObject stand-ins,
# so the collection rules are covered without an Outlook installation. They live
# here rather than inside the calendar runspace for exactly that reason.

function Read-ComProperty {
    <#
    .SYNOPSIS
        Reads one property from a COM item, returning $null instead of throwing.

    .DESCRIPTION
        Any property read can fail on a damaged appointment or a store that does
        not expose the property over IDispatch. Swallowing the exception here is
        deliberate and narrow: the caller's contract is "the value, or nothing",
        and every caller either substitutes a default or skips the item. Read
        failures are counted in the calendar debug payload rather than silently
        lost.

    .PARAMETER Item
        The COM item (or test stand-in) to read from.

    .PARAMETER Property
        Name of the property to read.

    .OUTPUTS
        The property value, or $null.

    .EXAMPLE
        Read-ComProperty $appointment 'Subject'
    #>
    param(
        [AllowNull()][object]$Item,
        [Parameter(Mandatory)][string]$Property
    )
    Set-StrictMode -Version Latest
    if ($null -eq $Item) { return $null }
    try { return $Item.$Property } catch { return $null }
}

function Read-ComDate {
    <#
    .SYNOPSIS
        Reads one property from a COM item as a DateTime, or $null.

    .DESCRIPTION
        Wraps Read-ComProperty with a DateTime cast so callers can compare start
        and end times without guarding every read. A property that is missing,
        unreadable, or not convertible yields $null, which Test-MeetingOnDate and
        Get-ScanAction both treat as "unknown" rather than as an error.

    .PARAMETER Item
        The COM item (or test stand-in) to read from.

    .PARAMETER Property
        Name of the date property to read, e.g. 'Start' or 'End'.

    .OUTPUTS
        System.DateTime, or $null.

    .EXAMPLE
        Read-ComDate $appointment 'Start'
    #>
    param(
        [AllowNull()][object]$Item,
        [Parameter(Mandatory)][string]$Property
    )
    Set-StrictMode -Version Latest
    $raw = Read-ComProperty $Item $Property
    if ($null -eq $raw) { return $null }
    try { return [DateTime]$raw } catch { return $null }
}

function Get-ComItemKey {
    <#
    .SYNOPSIS
        Builds the deduplication key for one Outlook item.

    .DESCRIPTION
        Reads the identity properties off the item and delegates to
        Get-MeetingKey, so callers do not repeat the guarded property reads.

    .PARAMETER Item
        The COM item (or test stand-in) to key.

    .OUTPUTS
        System.String

    .EXAMPLE
        Get-ComItemKey $appointment
    #>
    [OutputType([string])]
    param(
        [AllowNull()][object]$Item
    )
    Set-StrictMode -Version Latest
    return Get-MeetingKey -GlobalId (Read-ComProperty $Item 'GlobalAppointmentID') `
                          -Subject  (Read-ComProperty $Item 'Subject') `
                          -Start    (Read-ComDate     $Item 'Start') `
                          -End      (Read-ComDate     $Item 'End')
}

function New-MeetingRecord {
    <#
    .SYNOPSIS
        Builds the JSON-shaped meeting record the browser consumes.

    .DESCRIPTION
        One place where an Outlook item becomes the API's meeting shape:
        subject, ISO-8601 start and end, location, Teams join URL, and the
        account label. Times are emitted in round-trip ('o') format so the
        browser parses them unambiguously.

    .PARAMETER Item
        The COM item (or test stand-in) to convert. Must have a readable Start —
        callers filter with Test-MeetingOnDate first, so an unreadable one is a
        programming error and throws rather than emitting a broken record.

    .PARAMETER AccountKey
        The store's display name, mapped to a friendly label in the browser.

    .OUTPUTS
        System.Collections.Hashtable

    .EXAMPLE
        New-MeetingRecord $appointment 'me@example.com'
    #>
    [OutputType([hashtable])]
    param(
        [AllowNull()][object]$Item,
        [AllowNull()][object]$AccountKey
    )
    Set-StrictMode -Version Latest
    $start = Read-ComDate $Item 'Start'
    if ($null -eq $start) {
        throw 'New-MeetingRecord: item has no readable Start; filter with Test-MeetingOnDate first.'
    }
    $end = Read-ComDate $Item 'End'
    if ($null -eq $end) { $end = $start }
    $location = [string](Read-ComProperty $Item 'Location')
    $body     = [string](Read-ComProperty $Item 'Body')
    return @{
        subject  = Get-MeetingSubject (Read-ComProperty $Item 'Subject')
        start    = $start.ToString('o')
        end      = $end.ToString('o')
        location = $location
        joinUrl  = Get-TeamsJoinUrl "$location $body"
        account  = $AccountKey
    }
}

function Add-MeetingForDay {
    <#
    .SYNOPSIS
        Collects one Outlook item when it belongs to the requested day.

    .DESCRIPTION
        The single gate every collected meeting passes through: the item must
        overlap $Day and must not already be in $SeenKeys. $SeenKeys and $Sink are
        reference types mutated in place, so both passes over every folder share
        one dedup set and one result list.

    .PARAMETER Item
        The COM item (or test stand-in) to consider.

    .PARAMETER AccountKey
        The store's display name, passed through to the record.

    .PARAMETER Day
        Any DateTime on the day being collected; only its date part is used.

    .PARAMETER SeenKeys
        Dictionary of already-collected meeting keys, updated in place.

    .PARAMETER Sink
        List the new record is appended to.

    .OUTPUTS
        System.Boolean — $true only when a record was added.

    .EXAMPLE
        Add-MeetingForDay $appointment 'me@example.com' ([DateTime]::Today) $seen $results
    #>
    [OutputType([bool])]
    param(
        [AllowNull()][object]$Item,
        [AllowNull()][object]$AccountKey,
        [Parameter(Mandatory)][DateTime]$Day,
        [System.Collections.IDictionary]$SeenKeys,
        [System.Collections.Generic.List[object]]$Sink
    )
    Set-StrictMode -Version Latest
    # Not [Parameter(Mandatory)]: that rejects an empty collection, and both of
    # these legitimately start empty on the first meeting of the day.
    if ($null -eq $SeenKeys) { throw 'Add-MeetingForDay requires a non-null -SeenKeys.' }
    if ($null -eq $Sink)     { throw 'Add-MeetingForDay requires a non-null -Sink.' }
    $start = Read-ComDate $Item 'Start'
    $end   = Read-ComDate $Item 'End'
    if (-not (Test-MeetingOnDate -Start $start -End $end -Day $Day)) { return $false }
    $key = Get-ComItemKey $Item
    if ($SeenKeys.Contains($key)) { return $false }
    $SeenKeys[$key] = $true
    $Sink.Add((New-MeetingRecord $Item $AccountKey))
    return $true
}

function Add-RecurringOccurrence {
    <#
    .SYNOPSIS
        Collects any occurrence of a recurring series that falls on a given day.

    .DESCRIPTION
        Two routes are needed, and only both together find every occurrence.

        GetOccurrence returns the occurrence sitting in its original slot — the
        series' time of day applied to $Day — but throws for one that was moved
        or deleted. So an occurrence dragged to a different time today is
        invisible to it, and so is one moved into today from another day. Both of
        those live in the pattern's Exceptions collection, which is therefore
        scanned as well. Anything both routes return is absorbed by $SeenKeys.

        Deleted occurrences are skipped: they have no AppointmentItem to read,
        and a series cancelled for today must not appear.

    .PARAMETER Master
        The recurring master item (or test stand-in).

    .PARAMETER AccountKey
        The store's display name, passed through to each record.

    .PARAMETER Day
        Any DateTime on the day being collected; only its date part is used.

    .PARAMETER SeenKeys
        Dictionary of already-collected meeting keys, updated in place.

    .PARAMETER Sink
        List new records are appended to.

    .PARAMETER Diagnostics
        The calendar debug dictionary; exception counts and probe failures are
        recorded there instead of being discarded.

    .PARAMETER Track
        Callback invoked with every COM object this function acquires, returning
        it unchanged. The live server passes its Add-ComRef so acquired
        references are released after the request; the default is identity, which
        is what the tests use.

    .OUTPUTS
        System.Int32 — how many occurrences were added.

    .EXAMPLE
        Add-RecurringOccurrence $master 'me@example.com' ([DateTime]::Today) $seen $results $dbg
    #>
    [OutputType([int])]
    param(
        [AllowNull()][object]$Master,
        [AllowNull()][object]$AccountKey,
        [Parameter(Mandatory)][DateTime]$Day,
        [System.Collections.IDictionary]$SeenKeys,
        [System.Collections.Generic.List[object]]$Sink,
        [System.Collections.IDictionary]$Diagnostics,
        [scriptblock]$Track = { param($ComObject) $ComObject }
    )
    Set-StrictMode -Version Latest
    # Not [Parameter(Mandatory)]: that rejects an empty collection, and the dedup
    # set and result list legitimately start empty.
    if ($null -eq $SeenKeys)    { throw 'Add-RecurringOccurrence requires a non-null -SeenKeys.' }
    if ($null -eq $Sink)        { throw 'Add-RecurringOccurrence requires a non-null -Sink.' }
    if ($null -eq $Diagnostics) { throw 'Add-RecurringOccurrence requires a non-null -Diagnostics.' }
    $added   = 0
    $subject = Get-MeetingSubject (Read-ComProperty $Master 'Subject')

    $pattern = $null
    try { $pattern = & $Track $Master.GetRecurrencePattern() }
    catch {
        $Diagnostics.pass2Error += "GetRecurrencePattern($subject): $($_.Exception.Message); "
        return $added
    }
    if ($null -eq $pattern) { return $added }

    $masterStart = Read-ComDate $Master 'Start'
    if ($null -ne $masterStart) {
        $occurrence = $null
        try { $occurrence = & $Track $pattern.GetOccurrence($Day.Date.Add($masterStart.TimeOfDay)) } catch {}
        if ($null -ne $occurrence -and
            (Add-MeetingForDay -Item $occurrence -AccountKey $AccountKey -Day $Day -SeenKeys $SeenKeys -Sink $Sink)) {
            $added++
        }
    }

    try {
        $exceptions = & $Track (Read-ComProperty $pattern 'Exceptions')
        foreach ($exception in $exceptions) {
            # Guarded per exception rather than per collection: one unreadable
            # entry must not hide the rest, which is the failure mode this probe
            # exists to fix.
            try {
                $Diagnostics.exceptionsScanned++
                # A deleted occurrence has no AppointmentItem to read.
                $isDeleted = [bool](Read-ComProperty $exception 'Deleted')
                if ($isDeleted) { continue }
                $moved = & $Track (Read-ComProperty $exception 'AppointmentItem')
                if ($null -ne $moved -and
                    (Add-MeetingForDay -Item $moved -AccountKey $AccountKey -Day $Day -SeenKeys $SeenKeys -Sink $Sink)) {
                    $added++
                }
            } catch { continue }
        }
    } catch { $Diagnostics.pass2Error += "Exceptions($subject): $($_.Exception.Message); " }

    return $added
}

function Get-CalendarSubFolder {
    <#
    .SYNOPSIS
        Finds every folder beneath a parent that holds appointments.

    .DESCRIPTION
        Walks the folder tree recursively, collecting folders whose
        DefaultItemType is 1 (olAppointmentItem). Secondary calendars are
        routinely nested inside the default Calendar folder or a folder group, so
        a single-level walk silently misses them and their meetings never reach
        the strip.

        A folder that cannot be read is skipped rather than aborting the walk, and
        the depth bound stops a pathological or looping folder tree from stalling
        a request.

    .PARAMETER Parent
        The folder (or test stand-in) whose subtree is walked.

    .PARAMETER Depth
        Current recursion depth; callers start at 1.

    .PARAMETER MaxDepth
        Deepest level to visit. Levels beyond it are not walked.

    .PARAMETER Track
        Callback invoked with every COM object this function acquires, returning
        it unchanged. The live server passes its Add-ComRef so acquired
        references are released after the request; the default is identity, which
        is what the tests use.

    .OUTPUTS
        System.Object[] — the calendar folders found, in walk order.

    .EXAMPLE
        Get-CalendarSubFolder $store.GetRootFolder() 1 4
    #>
    param(
        [AllowNull()][object]$Parent,
        [int]$Depth = 1,
        [int]$MaxDepth = 4,
        [scriptblock]$Track = { param($ComObject) $ComObject }
    )
    Set-StrictMode -Version Latest
    $found = @()
    if ($null -eq $Parent -or $Depth -gt $MaxDepth) { return ,$found }
    $children = & $Track (Read-ComProperty $Parent 'Folders')
    if ($null -eq $children) { return ,$found }
    foreach ($child in $children) {
        try {
            $folder = & $Track $child
            if ((Read-ComProperty $folder 'DefaultItemType') -eq 1) { $found += $folder }
            $found += Get-CalendarSubFolder -Parent $folder -Depth ($Depth + 1) -MaxDepth $MaxDepth -Track $Track
        } catch { continue }
    }
    return ,$found
}
