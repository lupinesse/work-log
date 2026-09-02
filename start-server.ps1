$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"

# Shared, dependency-free helpers (HTTP debug-query detector + COM dedup guard).
# Dot-sourced here for the request handler, and kept as raw text so the calendar
# runspace can inject the same definitions (see Get-TodayMeetings). This gives
# server-helpers.ps1 a single, Pester-tested source of truth.
$serverHelpersPath          = Join-Path $root 'server-helpers.ps1'
. $serverHelpersPath
$script:serverHelpersSource = Get-Content -Path $serverHelpersPath -Raw

# Load personal config (not committed to git)
$NamedayApiToken  = ''
$AnthropicApiKey  = ''
$NotionToken      = ''
$NotionDatabaseId = ''
$WeatherLat       = 60.1887   # default: Helsinki
$WeatherLon       = 24.927
$WeatherName      = 'Helsinki'
# How many years back to look for recurring series when probing today's
# occurrences (see Get-TodayMeetings). Raise it if long-running recurring
# meetings are missing from the strip.
$CalendarLookBackYears = 3
# Names/substrings of calendars to leave off the strip entirely — a shared
# calendar someone else granted access to, a meeting-room calendar, etc. (see
# Test-CalendarNameExcluded). Case-insensitive substring match against both
# the Outlook account name and the calendar folder's own name.
$CalendarExcludeNames = @()
$configFile = Join-Path $root 'config.local.ps1'
if (Test-Path $configFile) { . $configFile }

# Log the configuration this run is using. Secrets are reported as configured or
# not, never echoed.
$effectiveLookBack = Get-CalendarLookBackYears -Requested $CalendarLookBackYears
if ($effectiveLookBack -ne $CalendarLookBackYears) {
    Write-Host "[cfg] CalendarLookBackYears=$CalendarLookBackYears is outside the supported 0-20 range; using $effectiveLookBack" -ForegroundColor Yellow
}
$excludeSummary = if ($CalendarExcludeNames -and $CalendarExcludeNames.Count) { $CalendarExcludeNames -join ', ' } else { 'none' }
Write-Host "[cfg] port=$port weather=$WeatherName ($WeatherLat, $WeatherLon) calendarLookBackYears=$effectiveLookBack calendarExcludeNames=$excludeSummary"
Write-Host "[cfg] nameday token: $(if ($NamedayApiToken) { 'configured' } else { 'not configured' }); Anthropic key: $(if ($AnthropicApiKey) { 'configured' } else { 'not configured' }); Notion: $(if ($NotionToken -and $NotionDatabaseId) { 'configured' } else { 'not configured' })"

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Start-Process "$($url)work-log.html"
Write-Host "Work log running at $($url)work-log.html"
Write-Host "Close this window to stop the server."

function Send-Json($res, $body, $status = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $res.StatusCode      = $status
    $res.ContentType     = 'application/json; charset=utf-8'
    $res.ContentLength64 = $bytes.Length
    try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
}

function Get-TodayMeetings {
    <#
    .SYNOPSIS
        Collects every meeting that falls on today from all Outlook calendars.

    .DESCRIPTION
        Runs the Outlook COM work in a dedicated STA runspace and returns a
        hashtable of @{ meetings = <list>; debug = <diagnostics> }, or
        @{ error = <message> } when Outlook cannot be reached.

        Calendars are gathered only from the signed-in user's own stores — see
        Test-PersonalCalendarStore — plus any nested folder that holds
        appointments, minus anything matching -ExcludeNames (see
        Test-CalendarNameExcluded). Each folder is read twice because no single
        Outlook query returns both shapes reliably — Pass 1 expands recurring
        occurrences, Pass 2 covers plain appointments and, when Pass 1 could not
        expand recurrences on that store, probes recurring series for an
        occurrence today.

        The decision rules (which day an item belongs to, when a scan may stop
        early, how duplicates are keyed, which stores/names count as personal)
        live in server-helpers.ps1 so they are unit-tested without Outlook.

    .PARAMETER LookBackYears
        How many years back the Pass 2 window reaches when probing recurring
        series, since a series' [Start] is its first occurrence and may predate
        the current year. Only used on stores where Pass 1 degraded. Clamped by
        Get-CalendarLookBackYears.

    .PARAMETER ExcludeNames
        Names/substrings of calendars to leave out entirely, matched against
        both the store's display name and each folder's own name. See
        Test-CalendarNameExcluded.

    .OUTPUTS
        System.Collections.Hashtable

    .EXAMPLE
        (Get-TodayMeetings -LookBackYears 3 -ExcludeNames @('Annina Antinranta')).meetings
    #>
    param(
        [int]$LookBackYears = 3,
        [string[]]$ExcludeNames = @()
    )
    $script = {
        # Track every COM object for explicit release in the finally block.
        # Outlook's shared resource pool is finite; without ReleaseComObject the
        # .NET GC holds COM references across runspace teardown and Outlook
        # eventually reports "exhausted all shared resources".
        $comRefs = [System.Collections.Generic.List[object]]::new()
        # Test-NewComRef is injected into this runspace from server-helpers.ps1
        # (see the AddScript call below), so the live COM path and the Pester
        # tests share one dedup guard instead of duplicating the logic.
        function Add-ComRef($obj) { if (Test-NewComRef $comRefs $obj) { $comRefs.Add($obj) }; return $obj }

        # How deep the folder walk descends looking for calendars. Secondary
        # calendars usually sit one or two levels below the mailbox root; the
        # bound stops a pathological folder tree from stalling a request.
        $maxCalendarFolderDepth = 4

        # Advances a cursor-style Items method (Find / FindNext / GetFirst /
        # GetNext). PowerShell's COM adapter is tried first; when it throws — as
        # it does on a store where Items arrives as a bare System.__ComObject,
        # taking every member with it — the call is retried late-bound through
        # IDispatch. A $null from a working adapter means end-of-collection and is
        # returned as-is; only a throw triggers the fallback. When neither route
        # produces an item the walk ends rather than the pass aborting.
        function Get-ComCursorItem($collection, [string]$member, [object[]]$parameters = @()) {
            $adapterWorked = $false
            $item = $null
            try {
                $item = if ($parameters.Count) { $collection.$member($parameters[0]) } else { $collection.$member() }
                $adapterWorked = $true
            } catch {}
            if ($adapterWorked) { return $item }
            try {
                $item = Invoke-ComMethod -Target $collection -Name $member -Arguments $parameters
                $dbg.lateBoundMembers++
                return $item
            } catch { return $null }
        }

        # Wraps Add-ComRef as a callback for the shared helpers in
        # server-helpers.ps1: they acquire COM objects (folders, recurrence
        # patterns) but must stay runnable without this runspace, so they take the
        # tracker as a parameter instead of calling it directly.
        $trackComRef = { param($ComObject) Add-ComRef $ComObject }

        $dbg = [ordered]@{
            storeCount        = 0
            storesSkipped     = 0
            foldersExcluded   = 0
            folderCount       = 0
            pass1Count        = 0
            pass2Count        = 0
            pass1UsedGetFirst = $false
            pass1Degraded     = 0
            pass1Walked       = 0
            lateBoundMembers  = 0
            unreadableItems   = 0
            exceptionsScanned = 0
            lookBackYears     = 0
            pass1Error        = ''
            pass2Error        = ''
            dateRange         = ''
            sep               = ''
            yearAnchor        = ''
            stores            = @()
            folders           = @()
        }

        try {
            $ol = $null
            try   { $ol = Add-ComRef ([Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')) }
            catch { $ol = Add-ComRef (New-Object -ComObject Outlook.Application) }

            $ns    = Add-ComRef ($ol.GetNamespace('MAPI'))
            $today    = [DateTime]::Today
            $tomorrow = $today.AddDays(1)
            # Filtering uses locale-independent year-boundary anchors (see Pass 1/2).
            # dateRange is kept in the debug payload using en-US strings for readability.
            $enUS = [Globalization.CultureInfo]::new('en-US')
            $dbg.dateRange = "$($today.ToString('M/d/yyyy HH:mm', $enUS)) → $($tomorrow.ToString('M/d/yyyy HH:mm', $enUS))"
            # Year anchors use the system locale's date separator so Outlook's MAPI
            # filter parser accepts the string.  Day=1 and month=1 are identical in
            # both d/M and M/d orderings, so the anchor date is locale-independent.
            $sep = [Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.DateSeparator
            $dbg.sep        = $sep
            $yearAnchor     = Get-YearAnchor -Year $today.Year -Separator $sep
            $dbg.yearAnchor = $yearAnchor
            $lookBack       = Get-CalendarLookBackYears -Requested $CalendarLookBackYears
            $dbg.lookBackYears = $lookBack

            $seen    = @{}
            $results = [System.Collections.Generic.List[object]]::new()

            # Collect all calendar folders across all accounts
            $calFolders = @()
            $stores = Add-ComRef ($ns.Stores)
            foreach ($store in $stores) {
                $dbg.storeCount++
                $storeType = try { [int]$store.ExchangeStoreType } catch { -1 }
                # Determine account key (ASCII-safe, mapped to display label in JS)
                $storeDisplay = try { $store.DisplayName } catch { '' }
                $accountKey = if ($storeDisplay) { $storeDisplay } else { $null }

                # Skip shared/delegate mailboxes and public-folder stores — only
                # the user's own mailbox, its archive, and local stores are
                # "personal" (see Test-PersonalCalendarStore).
                if (-not (Test-PersonalCalendarStore -StoreType $storeType)) { $dbg.storesSkipped++; continue }
                # Skip a whole store the user named explicitly, e.g. a shared
                # mailbox that happens to report as an ordinary mailbox type.
                if (Test-CalendarNameExcluded -Name $storeDisplay -ExcludeNames $CalendarExcludeNames) {
                    $dbg.storesSkipped++; continue
                }

                $beforeCount = $calFolders.Count
                # Method 1: GetDefaultFolder
                try {
                    $defaultFolder     = Add-ComRef ($store.GetDefaultFolder(9))
                    $defaultFolderName = try { [string](Read-ComProperty $defaultFolder 'Name') } catch { '' }
                    if (Test-CalendarNameExcluded -Name $defaultFolderName -ExcludeNames $CalendarExcludeNames) {
                        $dbg.foldersExcluded++
                    } else {
                        $calFolders += @{ folder = $defaultFolder; label = $accountKey }
                    }
                } catch {}

                # Method 2: walk the folder tree for anything holding appointments.
                try {
                    $rootFolder = Add-ComRef ($store.GetRootFolder())
                    foreach ($folder in (Get-CalendarSubFolder -Parent $rootFolder -Depth 1 -MaxDepth $maxCalendarFolderDepth -Track $trackComRef)) {
                        try {
                            $folderName = [string](Read-ComProperty $folder 'Name')
                            if (Test-CalendarNameExcluded -Name $folderName -ExcludeNames $CalendarExcludeNames) {
                                $dbg.foldersExcluded++
                                continue
                            }
                            $entryId      = Read-ComProperty $folder 'EntryID'
                            $alreadyAdded = $calFolders | Where-Object { (Read-ComProperty $_.folder 'EntryID') -eq $entryId }
                            if (-not $alreadyAdded) { $calFolders += @{ folder = $folder; label = $accountKey } }
                        } catch { continue }
                    }
                } catch {}

                $dbg.stores += [ordered]@{
                    name        = $storeDisplay
                    type        = $storeType
                    foldersFound = ($calFolders.Count - $beforeCount)
                }
            }

            $dbg.folderCount = $calFolders.Count
            # Sub-folder names used to be listed here to reveal calendars the
            # single-level walk was missing; the walk now recurses into them, so
            # the folders themselves appear in this list instead.
            $dbg.folders = @($calFolders | ForEach-Object {
                $fn        = [string](Read-ComProperty $_.folder 'Name')
                $itemCount = -1
                try { $folderItems = Add-ComRef ($_.folder.Items); $itemCount = $folderItems.Count } catch {}
                [ordered]@{ name = $fn; account = $_.label; itemCount = $itemCount }
            })

            # Read meetings from every calendar folder found
            foreach ($entry in $calFolders) {
                $calFolder  = $entry.folder
                $accountKey = $entry.label
                $folderName = [string](Read-ComProperty $calFolder 'Name')
                # Declared before Pass 1 so Pass 2 can read them even if Pass 1 throws.
                $incRecurOk   = $false
                $pass1Started = $true

                # Pass 1 — recurring occurrences via Find/FindNext.
                # Sort+IncludeRecurrences must be set before Find per Outlook COM docs.
                # If either call fails (COM type library not exposed via IDispatch on some
                # Exchange/delegate stores), fall back to GetFirst/GetNext scanning all
                # items — cannot break early when unsorted, but correctly finds today's
                # non-recurring items; recurring occurrences are handled in Pass 2.
                #
                # The Jan-1 anchor assumes no meeting still running today started in
                # an earlier year; a multi-day event spanning New Year is left to
                # Pass 2's wider window.
                try {
                    $items = Add-ComRef ($calFolder.Items)
                    $sortOk = $false
                    # Each member is tried through PowerShell's COM adapter, then
                    # late-bound. On stores where Items has no type information the
                    # adapter exposes nothing at all — Sort, IncludeRecurrences and
                    # the cursor methods alike — which leaves Pass 1 unable to run
                    # and every recurring meeting resting on Pass 2's probe.
                    try { $items.Sort('[Start]'); $sortOk = $true }
                    catch {
                        try {
                            [void](Invoke-ComMethod -Target $items -Name 'Sort' -Arguments @('[Start]'))
                            $sortOk = $true
                            $dbg.lateBoundMembers++
                        } catch { $dbg.pass1Error += "Sort: $($_.Exception.Message); " }
                    }
                    if ($sortOk) {
                        try { $items.IncludeRecurrences = $true; $incRecurOk = $true }
                        catch {
                            try {
                                Set-ComProperty -Target $items -Name 'IncludeRecurrences' -Value $true
                                $incRecurOk = $true
                                $dbg.lateBoundMembers++
                            } catch { $dbg.pass1Error += "IncludeRecurrences: $($_.Exception.Message); " }
                        }
                    }
                    $useGetNext = $false  # overridden to $true in the GetFirst fallback below
                    $cur = $null
                    if ($incRecurOk) {
                        $cur = Add-ComRef (Get-ComCursorItem $items 'Find' @("[Start] >= '$yearAnchor'"))
                    }
                    if ($null -eq $cur) {
                        Write-Host '[cal] Pass 1: using GetFirst fallback (Sort/IncludeRecurrences unavailable or Find returned null)' -ForegroundColor Yellow
                        $useGetNext = $true
                        $dbg.pass1UsedGetFirst = $true
                        $cur = Add-ComRef (Get-ComCursorItem $items 'GetFirst')
                    }
                    # Whether the walk ever started. A cursor that is null from the
                    # outset means Pass 1 contributed nothing, which Pass 2 has to
                    # know about even when the properties above were settable.
                    if ($null -ne $cur) { $dbg.pass1Walked++ } else { $pass1Started = $false }
                    while ($null -ne $cur) {
                        $itemStart = Read-ComDate $cur 'Start'
                        $itemEnd   = Read-ComDate $cur 'End'
                        # Get-ScanAction only says 'stop' on a start-sorted collection
                        # and never for an unreadable item, so one damaged appointment
                        # can no longer truncate the rest of the day.
                        $action = Get-ScanAction -Start $itemStart -End $itemEnd -Day $today -Sorted $incRecurOk
                        if ($action -eq 'stop') { break }
                        if ($null -eq $itemStart) { $dbg.unreadableItems++ }
                        if ($action -eq 'take' -and
                            (Add-MeetingForDay -Item $cur -AccountKey $accountKey -Day $today -SeenKeys $seen -Sink $results)) {
                            $dbg.pass1Count++
                        }
                        $cur = Add-ComRef (Get-ComCursorItem $items $(if ($useGetNext) { 'GetNext' } else { 'FindNext' }))
                    }
                } catch { $dbg.pass1Error += "$($_.Exception.Message); " }

                # Pass 2 — plain appointments, and recurring series Pass 1 could not
                # expand. IncludeRecurrences=false is the default; setting it
                # explicitly is defensive and non-fatal if the property is unavailable.
                #
                # A recurring item's [Start] is the *first* occurrence of the series,
                # so a weekly meeting created in an earlier year sits outside a
                # current-year window and would never be probed for today. The window
                # therefore reaches $lookBack years further back — but only where Pass 1
                # degraded, because the probe exists solely to compensate for
                # unexpanded recurrences and scanning years of history costs a
                # COM round-trip per item.
                # Degraded covers both shapes of failure: recurrences that could not
                # be expanded, and a walk that never got a cursor to start from.
                $pass1Degraded = (-not $incRecurOk) -or (-not $pass1Started)
                if ($pass1Degraded) { $dbg.pass1Degraded++ }
                $scanFromYear = if ($pass1Degraded) { $today.Year - $lookBack } else { $today.Year }
                if ($pass1Degraded) {
                    Write-Host "[cal] '$folderName': pass 1 could not expand recurrences; pass 2 probing series from $scanFromYear" -ForegroundColor Yellow
                }
                try {
                    $items2 = Add-ComRef ($calFolder.Items)
                    try { $items2.IncludeRecurrences = $false }
                    catch {
                        try {
                            Set-ComProperty -Target $items2 -Name 'IncludeRecurrences' -Value $false
                            $dbg.lateBoundMembers++
                        } catch { $dbg.pass2Error += "IncludeRecurrences: $($_.Exception.Message); " }
                    }
                    $fromAnchor     = Get-YearAnchor -Year $scanFromYear -Separator $sep
                    $nextYearAnchor = Get-YearAnchor -Year ($today.Year + 1) -Separator $sep
                    $restriction = "[Start] >= '$fromAnchor' AND [Start] < '$nextYearAnchor'"
                    $filtered = Add-ComRef (Get-ComCursorItem $items2 'Restrict' @($restriction))
                    if ($null -eq $filtered) {
                        Write-Host '[cal] Pass 2: Restrict unavailable, iterating all items' -ForegroundColor Yellow
                        $filtered = $items2
                    }
                    foreach ($item in $filtered) {
                        try {
                            $itemStart = Read-ComDate $item 'Start'
                            if ($null -eq $itemStart) { $dbg.unreadableItems++; continue }
                            if (Add-MeetingForDay -Item $item -AccountKey $accountKey -Day $today -SeenKeys $seen -Sink $results) {
                                $dbg.pass2Count++
                                continue
                            }
                            # Not itself on today — but a recurring series can still
                            # have an occurrence today, whatever day its master is on.
                            $isRecurring = $false
                            try { $isRecurring = [bool]$item.IsRecurring } catch {}
                            if (-not $isRecurring) { continue }
                            $occurrencesAdded = Add-RecurringOccurrence -Master $item -AccountKey $accountKey -Day $today `
                                                        -SeenKeys $seen -Sink $results -Diagnostics $dbg -Track $trackComRef
                            $dbg.pass2Count += $occurrencesAdded
                        } catch { continue }
                    }
                } catch { $dbg.pass2Error += "$($_.Exception.Message); " }
            }

            Write-Host "[cal] $($results.Count) meeting(s) from $($dbg.folderCount) calendar(s); pass1=$($dbg.pass1Count) pass2=$($dbg.pass2Count) degraded=$($dbg.pass1Degraded) unreadable=$($dbg.unreadableItems)" -ForegroundColor DarkGray
            return @{ meetings = $results; debug = $dbg }
        } catch {
            return @{ error = $_.Exception.Message }
        } finally {
            # Release every tracked COM reference in reverse order, then force a GC
            # cycle so Outlook's reference counts drop to zero before the runspace
            # closes. Without this, Outlook accumulates dangling references and
            # eventually reports "exhausted all shared resources".
            for ($i = $comRefs.Count - 1; $i -ge 0; $i--) {
                try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($comRefs[$i]) } catch {}
            }
            [System.GC]::Collect()
            [System.GC]::WaitForPendingFinalizers()
        }
    }

    # Create runspace with STA apartment state set BEFORE opening
    $iss = [Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $rs  = [Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $rs.ApartmentState = [Threading.ApartmentState]::STA
    $rs.Open()
    # The scriptblock reads $CalendarLookBackYears/$CalendarExcludeNames; a
    # runspace does not inherit the caller's variables, so they are set
    # explicitly rather than passed as arguments (the helpers script runs first
    # in the same pipeline).
    $rs.SessionStateProxy.SetVariable('CalendarLookBackYears', $LookBackYears)
    $rs.SessionStateProxy.SetVariable('CalendarExcludeNames', $ExcludeNames)

    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
    # Inject the shared helpers first so Add-ComRef can call Test-NewComRef.
    # server-helpers.ps1 only declares functions, so it adds nothing to $out.
    $null = $ps.AddScript($script:serverHelpersSource)
    $null = $ps.AddScript($script)
    $out = $ps.Invoke()
    $ps.Dispose()
    $rs.Close()
    return $out
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add('Access-Control-Allow-Origin', '*')

    try {
        # Config endpoint — exposes non-secret runtime config to the browser app
        if ($req.Url.LocalPath -eq '/api/config' -and $req.HttpMethod -eq 'GET') {
            $cfg = "{`"weatherLat`":$WeatherLat,`"weatherLon`":$WeatherLon,`"weatherName`":`"$WeatherName`"}"
            Send-Json $res $cfg 200
            continue
        }

        # Nameday proxy — forwards to nimipaivarajapinta.fi bypassing browser CORS
        if ($req.Url.LocalPath -like '/api/namedays*' -or $req.Url.LocalPath -like '/api/typesense*') {
            try {
                $token  = $NamedayApiToken
                $path   = $req.Url.LocalPath  # already /api/namedays/... or /api/typesense/...
                $target = 'https://nimipaivarajapinta.fi' + $path
                if ($req.Url.Query) { $target += $req.Url.Query }

                $wc = New-Object System.Net.WebClient
                $wc.Encoding = [System.Text.Encoding]::UTF8
                $wc.Headers.Add('Authorization', "Bearer $token")
                $wc.Headers.Add('Content-Type', 'application/json')

                $result = if ($req.HttpMethod -eq 'POST') {
                    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                    $body   = $reader.ReadToEnd()
                    $wc.UploadString($target, 'POST', $body)
                } else {
                    $wc.DownloadString($target)
                }

                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType     = 'application/json; charset=utf-8'
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $msg   = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message -replace '"',"'")`"}")
                $res.StatusCode      = 500
                $res.ContentType     = 'application/json'
                $res.ContentLength64 = $msg.Length
                $res.OutputStream.Write($msg, 0, $msg.Length)
            }
            try { $res.Close() } catch {}
            continue
        }

        # AI proxy — forwards to Anthropic API bypassing browser CORS
        if ($req.Url.LocalPath -eq '/api/ai' -and $req.HttpMethod -eq 'POST') {
            try {
                if (-not $AnthropicApiKey) {
                    Send-Json $res "{`"error`":`"AI key not configured`"}" 500
                } else {
                    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                    $body   = $reader.ReadToEnd()

                    $wc = New-Object System.Net.WebClient
                    $wc.Encoding = [System.Text.Encoding]::UTF8
                    $wc.Headers.Add('x-api-key', $AnthropicApiKey)
                    $wc.Headers.Add('anthropic-version', '2023-06-01')
                    $wc.Headers.Add('Content-Type', 'application/json')

                    $result = $wc.UploadString('https://api.anthropic.com/v1/messages', 'POST', $body)
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                    $res.ContentType     = 'application/json; charset=utf-8'
                    $res.ContentLength64 = $bytes.Length
                    $res.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } catch {
                $msg = $_.Exception.Message -replace '"',"'"
                $fullErr = "AI API error: $msg`n$($_.Exception.InnerException.Message)"
                Write-Host "ERROR: $fullErr" -ForegroundColor Red
                Send-Json $res "{`"error`":`"$msg`"}" 500
            }
            try { $res.Close() } catch {}
            continue
        }

        # Notion AI proxy - forwards to Anthropic with Notion MCP token injected server-side
        if ($req.Url.LocalPath -eq '/api/notion-ai' -and $req.HttpMethod -eq 'POST') {
            try {
                if (-not $AnthropicApiKey) {
                    Send-Json $res "{`"error`":`"AI key not configured`"}" 500
                } elseif (-not $NotionToken) {
                    Send-Json $res "{`"error`":`"Notion token not configured - add NotionToken to config.local.ps1`"}" 500
                } else {
                    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                    $bodyStr = $reader.ReadToEnd()

                    # Rebuild body with Notion auth token; use @() to force arrays
                    # Use string concatenation (not interpolation) so $ in task titles is safe
                    $parsed   = $bodyStr | ConvertFrom-Json
                    $mdl      = if ($parsed.model)      { $parsed.model }      else { 'claude-sonnet-4-6' }
                    $mtok     = if ($parsed.max_tokens) { [int]$parsed.max_tokens } else { 1000 }
                    $msgsJson = ConvertTo-Json -InputObject @($parsed.messages) -Depth 5 -Compress
                    $mcpJson  = '[{"type":"url","url":"https://mcp.notion.com/mcp","name":"notion","authorization_token":"' + $NotionToken + '"}]'
                    $newBody  = '{"model":"' + $mdl + '","max_tokens":' + $mtok + ',"mcp_servers":' + $mcpJson + ',"messages":' + $msgsJson + '}'

                    $wc = New-Object System.Net.WebClient
                    $wc.Encoding = [System.Text.Encoding]::UTF8
                    $wc.Headers.Add('x-api-key', $AnthropicApiKey)
                    $wc.Headers.Add('anthropic-version', '2023-06-01')
                    $wc.Headers.Add('anthropic-beta', 'mcp-client-2025-04-04')
                    $wc.Headers.Add('Content-Type', 'application/json')

                    $result = $wc.UploadString('https://api.anthropic.com/v1/messages', 'POST', $newBody)
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                    $res.ContentType     = 'application/json; charset=utf-8'
                    $res.ContentLength64 = $bytes.Length
                    $res.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } catch {
                $notionErr = $_.Exception.Message -replace '"',"'" -replace "`r`n",' ' -replace "`n",' '
                $notionDetail = ''
                try {
                    $webEx = if ($_.Exception.InnerException -is [System.Net.WebException]) { $_.Exception.InnerException } `
                             elseif ($_.Exception -is [System.Net.WebException]) { $_.Exception } else { $null }
                    if ($webEx -and $webEx.Response) {
                        $errStream = $webEx.Response.GetResponseStream()
                        $errReader = New-Object System.IO.StreamReader($errStream, [System.Text.Encoding]::UTF8)
                        $notionDetail = $errReader.ReadToEnd()
                        $errReader.Close()
                    }
                } catch {}
                Write-Host ERROR: $notionErr -ForegroundColor Red
                if ($notionDetail) { Write-Host "DETAIL: $notionDetail" -ForegroundColor Yellow }
                $safeDetail = $notionDetail -replace '"',"'" -replace "`r`n",' ' -replace "`n",' '
                Send-Json $res "{`"error`":`"$notionErr`",`"detail`":`"$safeDetail`"}" 500
            }
            try { $res.Close() } catch {}
            continue
        }

        # Notion direct REST -- query Projects DB for matching Epic, create child page (no AI)
        if ($req.Url.LocalPath -eq '/api/notion-add-task' -and $req.HttpMethod -eq 'POST') {
            try {
                if (-not $NotionToken) {
                    Send-Json $res '{"error":"Notion token not configured"}' 500
                } else {
                    $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                    $bodyStr = $reader.ReadToEnd()
                    $parsed  = $bodyStr | ConvertFrom-Json
                    $taskTitle = [string]$parsed.title
                    $epic      = ([string]$parsed.epic).ToLower()
                    $dbId      = $NotionDatabaseId   # set in config.local.ps1

                    # Step 1 -- query database sorted by last-edited; filter in PS for resilience
                    $wc1 = New-Object System.Net.WebClient
                    $wc1.Encoding = [System.Text.Encoding]::UTF8
                    $wc1.Headers.Add('Authorization', 'Bearer ' + $NotionToken)
                    $wc1.Headers.Add('Notion-Version', '2022-06-28')
                    $wc1.Headers.Add('Content-Type', 'application/json')
                    $qJson = '{"sorts":[{"timestamp":"last_edited_time","direction":"descending"}],"page_size":50}'
                    $qRaw  = $wc1.UploadString('https://api.notion.com/v1/databases/' + $dbId + '/query', 'POST', $qJson)
                    $qData = $qRaw | ConvertFrom-Json

                    # Find first Active page whose Epic matches the category
                    $match = $null
                    foreach ($pg in @($qData.results)) {
                        # Status: handles both Notion 'status' type and legacy 'select' type
                        $sProp = $pg.properties.Status
                        $sVal  = ''
                        if ($sProp -and $sProp.status)     { $sVal = [string]$sProp.status.name }
                        elseif ($sProp -and $sProp.select) { $sVal = [string]$sProp.select.name }
                        if ($sVal -and $sVal.ToLower() -ne 'active') { continue }

                        # Epic: handles 'select', 'multi_select', and 'rich_text' types
                        $eProp = $pg.properties.Epic
                        $eVal  = ''
                        if ($eProp -and $eProp.select) {
                            $eVal = [string]$eProp.select.name
                        } elseif ($eProp -and $eProp.multi_select -and @($eProp.multi_select).Count -gt 0) {
                            $eVal = [string](@($eProp.multi_select)[0].name)
                        } elseif ($eProp -and $eProp.rich_text -and @($eProp.rich_text).Count -gt 0) {
                            $eVal = [string](@($eProp.rich_text)[0].plain_text)
                        }
                        if ($eVal.ToLower() -eq $epic) { $match = $pg; break }
                    }

                    # Fallback: if no exact Epic match, use first Active project (any epic)
                    if (-not $match) {
                        foreach ($pg in @($qData.results)) {
                            $sProp = $pg.properties.Status
                            $sVal  = ''
                            if ($sProp -and $sProp.status)     { $sVal = [string]$sProp.status.name }
                            elseif ($sProp -and $sProp.select) { $sVal = [string]$sProp.select.name }
                            if ($sVal.ToLower() -eq 'active') { $match = $pg; break }
                        }
                    }

                    if (-not $match) {
                        Send-Json $res ('{"error":"No active project found (tried epic: ' + $epic + ')"}') 404
                    } else {
                        # Step 2 -- create child page under the matched project
                        $parentId  = [string]$match.id
                        $titleJson = ConvertTo-Json -InputObject $taskTitle -Compress
                        $cJson = '{"parent":{"page_id":"' + $parentId + '"},"properties":{"title":{"title":[{"text":{"content":' + $titleJson + '}}]}}}'

                        $wc2 = New-Object System.Net.WebClient
                        $wc2.Encoding = [System.Text.Encoding]::UTF8
                        $wc2.Headers.Add('Authorization', 'Bearer ' + $NotionToken)
                        $wc2.Headers.Add('Notion-Version', '2022-06-28')
                        $wc2.Headers.Add('Content-Type', 'application/json')
                        $cRaw  = $wc2.UploadString('https://api.notion.com/v1/pages', 'POST', $cJson)
                        $cData = $cRaw | ConvertFrom-Json

                        $pageUrl = [string]$cData.url
                        if (-not $pageUrl) { $pageUrl = 'https://notion.so/' + ([string]$cData.id -replace '-','') }
                        Send-Json $res ('{"url":"' + $pageUrl + '"}')
                    }
                }
            } catch {
                $ntErr    = $_.Exception.Message -replace '"',"'" -replace "`r`n",' ' -replace "`n",' '
                $ntDetail = ''
                try {
                    $ntEx = $null
                    if ($_.Exception.InnerException -is [System.Net.WebException]) { $ntEx = $_.Exception.InnerException }
                    elseif ($_.Exception -is [System.Net.WebException]) { $ntEx = $_.Exception }
                    if ($ntEx -and $ntEx.Response) {
                        $ntStream = $ntEx.Response.GetResponseStream()
                        $ntReader = New-Object System.IO.StreamReader($ntStream, [System.Text.Encoding]::UTF8)
                        $ntDetail = $ntReader.ReadToEnd() -replace '"',"'" -replace "`r`n",' ' -replace "`n",' '
                        $ntReader.Close()
                    }
                } catch {}
                Write-Host "NOTION-TASK ERROR: $ntErr" -ForegroundColor Red
                if ($ntDetail) { Write-Host "DETAIL: $ntDetail" -ForegroundColor Yellow }
                Send-Json $res ('{"error":"' + $ntErr + '","detail":"' + $ntDetail + '"}') 500
            }
            try { $res.Close() } catch {}
            continue
        }

        # Portable deploy — runs the npm portable build + copy to .portable-dest
        if ($req.Url.LocalPath -eq '/api/portable-deploy' -and $req.HttpMethod -eq 'POST') {
            try {
                $start = Get-Date
                # Run from project root (where the listener lives)
                Push-Location $root
                try {
                    $output = & npm run portable:deploy 2>&1 | Out-String
                    $exitCode = $LASTEXITCODE
                } finally {
                    Pop-Location
                }
                $ms = [int]((Get-Date) - $start).TotalMilliseconds
                $ok = if ($exitCode -eq 0) { 'true' } else { 'false' }
                # Escape for JSON — backslashes, quotes, newlines
                $safeOutput = $output -replace '\\', '\\' -replace '"', '\"' -replace "`r", '' -replace "`n", '\n'
                Send-Json $res "{`"ok`":$ok,`"durationMs`":$ms,`"exitCode`":$exitCode,`"output`":`"$safeOutput`"}" $(if ($exitCode -eq 0) { 200 } else { 500 })
            } catch {
                $msg = $_.Exception.Message -replace '"',"'"
                Send-Json $res "{`"ok`":false,`"error`":`"$msg`"}" 500
            }
            try { $res.Close() } catch {}
            continue
        }

        if ($req.Url.LocalPath -eq '/api/calendar') {
            try {
                $isDebug = Test-DebugQuery $req.Url.Query
                # PowerShell unrolls the single-item Collection[PSObject] on return,
                # so $result is the wrapper hashtable directly, not a collection.
                $result = Get-TodayMeetings -LookBackYears $CalendarLookBackYears -ExcludeNames $CalendarExcludeNames

                if ($null -eq $result) {
                    Write-Host '[cal] Get-TodayMeetings returned null — returning empty' -ForegroundColor Yellow
                    Send-Json $res '[]'
                } elseif ($null -ne $result.error) {
                    $errMsg = [string]$result.error -replace '"',"'"
                    Send-Json $res "{`"error`":`"$errMsg`"}" 500
                } else {
                    $meetings = @($result.meetings)
                    if ($isDebug -and $null -ne $result.debug) {
                        $meetingsJson = if ($meetings.Count -gt 0) { ConvertTo-Json -InputObject $meetings -Compress -Depth 3 } else { '[]' }
                        $debugJson    = ConvertTo-Json -InputObject $result.debug -Compress -Depth 3
                        Send-Json $res "{`"meetings`":$meetingsJson,`"_debug`":$debugJson}"
                    } else {
                        $json = if ($meetings.Count -gt 0) { ConvertTo-Json -InputObject $meetings -Compress -Depth 3 } else { '[]' }
                        Send-Json $res $json
                    }
                }
            } catch {
                $msg = $_.Exception.Message -replace '"',"'"
                Send-Json $res "{`"error`":`"$msg`"}" 500
            }
        } else {
            # Static file serving
            $localPath = $req.Url.LocalPath
            # Root path → serve work-log.html as the index
            if ($localPath -eq '/' -or $localPath -eq '') { $localPath = '/work-log.html' }
            $file = Join-Path $root ($localPath.TrimStart('/') -replace '/', '\')
            if (Test-Path $file -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($file)
                $ext   = [IO.Path]::GetExtension($file).ToLower()
                $res.ContentType = switch ($ext) {
                    '.html' { 'text/html; charset=utf-8' }
                    '.js'   { 'application/javascript' }
                    '.css'  { 'text/css' }
                    default { 'application/octet-stream' }
                }
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = 404
            }
        }
    } catch {
        try { $res.StatusCode = 500 } catch {}
    } finally {
        try { $res.Close() } catch {}
    }
}
