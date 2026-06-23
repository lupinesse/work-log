<#
.SYNOPSIS
    Pure, side-effect-free helpers shared by start-server.ps1 and its Pester tests.

.DESCRIPTION
    These functions hold no Outlook/COM or HttpListener state, so they can be
    dot-sourced from start-server.ps1 (production use) and from
    test/calendar.Tests.ps1 (so the tests exercise the real logic instead of a
    hand-rolled copy). Keeping them here gives the HTTP debug-query detector and
    the COM dedup guard a single, tested source of truth.

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
    param(
        [string]$Query
    )
    Set-StrictMode -Version Latest
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
    param(
        [System.Collections.Generic.List[object]]$List,
        $ComObject
    )
    Set-StrictMode -Version Latest
    return [bool]($null -ne $ComObject -and -not $List.Contains($ComObject))
}
