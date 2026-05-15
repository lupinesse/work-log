$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = "http://localhost:$port/"

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Start-Process "$($url)work-log.html"
Write-Host "Work log running at $($url)work-log.html"
Write-Host "Close this window to stop the server."

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $res  = $ctx.Response

    $res.Headers.Add('Access-Control-Allow-Origin', '*')

    # Calendar endpoint — reads today's meetings from local Outlook via COM
    if ($req.Url.LocalPath -eq '/api/calendar') {
        try {
            $outlook  = New-Object -ComObject Outlook.Application
            $ns       = $outlook.GetNamespace('MAPI')
            $calFolder = $ns.GetDefaultFolder(9)  # 9 = olFolderCalendar

            $today    = [DateTime]::Today
            $tomorrow = $today.AddDays(1)

            $items = $calFolder.Items
            $items.IncludeRecurrences = $true
            $items.Sort('[Start]')

            # Restrict to today's appointments
            $fmt    = 'MM/dd/yyyy HH:mm'
            $filter = "[Start] >= '$($today.ToString($fmt))' AND [Start] < '$($tomorrow.ToString($fmt))'"
            $filtered = $items.Restrict($filter)

            $meetings = @()
            foreach ($item in $filtered) {
                # Skip free/tentative if desired — 0=Free, 1=Tentative, 2=Busy, 3=OOF, 4=WorkingElsewhere
                # Extract Teams URL from body or location
                $joinUrl = $null
                $body = try { $item.Body } catch { '' }
                $loc  = try { $item.Location } catch { '' }
                $haystack = "$loc $body"
                if ($haystack -match 'https://teams\.microsoft\.com/[^\s"<>]+') {
                    $joinUrl = $matches[0] -replace '&amp;','&'
                }

                $meetings += [ordered]@{
                    subject  = $item.Subject
                    start    = $item.Start.ToString('o')
                    end      = $item.End.ToString('o')
                    location = $loc
                    joinUrl  = $joinUrl
                    isOnline = ($item.IsOnlineMeeting -eq $true)
                    status   = [int]$item.BusyStatus
                }
            }

            $json  = ConvertTo-Json -InputObject $meetings -Compress -Depth 3
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.ContentType     = 'application/json; charset=utf-8'
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $err   = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode      = 500
            $res.ContentType     = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.Close()
        continue
    }

    # Static file serving
    $file = Join-Path $root ($req.Url.LocalPath.TrimStart('/') -replace '/', '\')

    if (Test-Path $file -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext   = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($ext -eq '.html') { 'text/html; charset=utf-8' }
                           elseif ($ext -eq '.js') { 'application/javascript' }
                           elseif ($ext -eq '.css') { 'text/css' }
                           else { 'application/octet-stream' }
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
    }
    $res.Close()
}
