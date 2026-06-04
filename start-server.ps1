$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"

# Load personal config (not committed to git)
$NamedayApiToken  = ''
$AnthropicApiKey  = ''
$NotionToken      = ''
$NotionDatabaseId = ''
$WeatherLat       = 60.1887   # default: Helsinki
$WeatherLon       = 24.927
$WeatherName      = 'Helsinki'
$configFile = Join-Path $root 'config.local.ps1'
if (Test-Path $configFile) { . $configFile }

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
    $script = {
        try {
            $ol = $null
            try   { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
            catch { $ol = New-Object -ComObject Outlook.Application }

            $ns    = $ol.GetNamespace('MAPI')
            $today    = [DateTime]::Today
            $tomorrow = $today.AddDays(1)
            # Outlook MAPI Restrict requires US-English date format regardless of system locale
            $enUS = [Globalization.CultureInfo]::new('en-US')
            $d1   = $today.ToString('M/d/yyyy HH:mm', $enUS)
            $d2   = $tomorrow.ToString('M/d/yyyy HH:mm', $enUS)

            $seen    = @{}
            $results = @()

            # Collect all calendar folders across all accounts
            $calFolders = @()
            foreach ($store in $ns.Stores) {
                # Skip public folders
                try { if ($store.ExchangeStoreType -eq 3) { continue } } catch {}

                # Determine account key (ASCII-safe, mapped to display label in JS)
                $storeDisplay = try { $store.DisplayName } catch { '' }
                $accountKey = if ($storeDisplay) { $storeDisplay } else { $null }

                # Method 1: GetDefaultFolder
                try { $calFolders += @{ folder = $store.GetDefaultFolder(9); label = $accountKey } } catch {}

                # Method 2: Walk root folders looking for IPF.Appointment (calendar class)
                try {
                    $root = $store.GetRootFolder()
                    foreach ($folder in $root.Folders) {
                        try {
                            if ($folder.DefaultItemType -eq 1) {
                                $alreadyAdded = $calFolders | Where-Object { $_.folder.EntryID -eq $folder.EntryID }
                                if (-not $alreadyAdded) { $calFolders += @{ folder = $folder; label = $accountKey } }
                            }
                        } catch {}
                    }
                } catch {}
            }

            # Read meetings from every calendar folder found
            foreach ($entry in $calFolders) {
                $calFolder   = $entry.folder
                $accountKey = $entry.label
                # Pass 1 — recurring occurrences via Find/FindNext.
                # Restrict is unreliable when IncludeRecurrences=$true on some Outlook
                # versions: it matches the master appointment's original start date
                # (e.g. April) rather than each occurrence's date. Find/FindNext
                # correctly walks occurrences at their actual start times and jumps
                # straight to today without iterating the full calendar history.
                try {
                    $items = $calFolder.Items
                    $items.IncludeRecurrences = $true
                    $items.Sort('[Start]')
                    $cur = try { $items.Find("[Start] >= '$d1'") } catch { $null }
                    while ($cur -ne $null) {
                        $startDate = $null
                        try { $startDate = ([DateTime]$cur.Start).Date } catch {}
                        if ($startDate -eq $null -or $startDate -gt $today) { break }

                        if ($startDate -eq $today) {
                            $subject = try { $cur.Subject  } catch { '(no title)' }
                            $key     = "$subject|$($cur.Start)"
                            if (-not $seen.ContainsKey($key)) {
                                $seen[$key] = $true
                                $loc     = try { $cur.Location } catch { '' }
                                $body    = try { $cur.Body     } catch { '' }
                                $joinUrl = $null
                                if (("$loc $body") -match 'https://teams\.microsoft\.com/[^\s"<>]+') {
                                    $joinUrl = $matches[0] -replace '&amp;','&'
                                }
                                $results += @{
                                    subject  = $subject
                                    start    = ([DateTime]$cur.Start).ToString('o')
                                    end      = ([DateTime]$cur.End).ToString('o')
                                    location = $loc
                                    joinUrl  = $joinUrl
                                    account  = $accountKey
                                }
                            }
                        }
                        $cur = try { $items.FindNext() } catch { $null }
                    }
                } catch {}

                # Pass 2 — non-recurring items via Restrict (fast and correct without
                # IncludeRecurrences). The $seen map deduplicates any overlap.
                try {
                    $items2 = $calFolder.Items
                    $items2.IncludeRecurrences = $false
                    $items2.Sort('[Start]')
                    $filtered = $items2.Restrict("[Start] >= '$d1' AND [Start] < '$d2'")
                    foreach ($item in $filtered) {
                        try {
                            $startDate = ([DateTime]$item.Start).Date
                            if ($startDate -ne $today) { continue }
                        } catch { continue }

                        $subject = try { $item.Subject  } catch { '(no title)' }
                        $key     = "$subject|$($item.Start)"
                        if ($seen.ContainsKey($key)) { continue }
                        $seen[$key] = $true

                        $loc     = try { $item.Location } catch { '' }
                        $body    = try { $item.Body     } catch { '' }
                        $joinUrl = $null
                        if (("$loc $body") -match 'https://teams\.microsoft\.com/[^\s"<>]+') {
                            $joinUrl = $matches[0] -replace '&amp;','&'
                        }
                        $results += @{
                            subject  = $subject
                            start    = ([DateTime]$item.Start).ToString('o')
                            end      = ([DateTime]$item.End).ToString('o')
                            location = $loc
                            joinUrl  = $joinUrl
                            account  = $accountKey
                        }
                    }
                } catch {}
            }

            return $results
        } catch {
            return @{ error = $_.Exception.Message }
        }
    }

    # Create runspace with STA apartment state set BEFORE opening
    $iss = [Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $rs  = [Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $rs.ApartmentState = [Threading.ApartmentState]::STA
    $rs.Open()

    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
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
                $meetings = Get-TodayMeetings
                # Check if first result is an error object
                if ($meetings.Count -eq 1 -and $meetings[0].ContainsKey('error')) {
                    Send-Json $res "{`"error`":`"$($meetings[0].error -replace '"',"'")`"}" 500
                } else {
                    $json = if ($meetings.Count -gt 0) {
                        ConvertTo-Json -InputObject @($meetings) -Compress -Depth 3
                    } else { '[]' }
                    Send-Json $res $json
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
