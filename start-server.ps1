$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"

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

            # Iterate all stores (accounts) to get all calendars
            foreach ($store in $ns.Stores) {
                try {
                    $calFolder = $store.GetDefaultFolder(9)
                } catch { continue }

                foreach ($useRecurring in @($true, $false)) {
                    try {
                        $items = $calFolder.Items
                        $items.Sort('[Start]')
                        $items.IncludeRecurrences = $useRecurring
                        $filtered = $items.Restrict("[Start] >= '$d1' AND [Start] < '$d2'")

                        foreach ($item in $filtered) {
                            # Verify date using .Date comparison (avoids type quirks)
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
