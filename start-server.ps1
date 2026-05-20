$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"

# Load personal config (not committed to git)
$NamedayApiToken = ''
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
            $cult = [Globalization.CultureInfo]::CurrentCulture
            $d1   = $today.ToString($cult.DateTimeFormat.ShortDatePattern)
            $d2   = $tomorrow.ToString($cult.DateTimeFormat.ShortDatePattern)

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
                foreach ($useRecurring in @($true, $false)) {
                    try {
                        $items = $calFolder.Items
                        $items.Sort('[Start]')
                        $items.IncludeRecurrences = $useRecurring
                        $filtered = $items.Restrict("[Start] >= '$d1' AND [Start] < '$d2'")

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
                    } catch { continue }
                }
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
            $file = Join-Path $root ($req.Url.LocalPath.TrimStart('/') -replace '/', '\')
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
