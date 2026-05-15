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
            # Connect to the already-running Outlook instead of launching a new one
            try {
                $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
            } catch {
                $outlook = New-Object -ComObject Outlook.Application
            }

            $ns        = $outlook.GetNamespace('MAPI')
            $calFolder = $ns.GetDefaultFolder(9)  # 9 = olFolderCalendar

            $today    = [DateTime]::Today
            $tomorrow = $today.AddDays(1)

            $items = $calFolder.Items
            $items.IncludeRecurrences = $true
            $items.Sort('[Start]')

            # Use invariant date format to avoid locale issues
            $start_str = $today.ToString('MM/dd/yyyy HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
            $end_str   = $tomorrow.ToString('MM/dd/yyyy HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
            $filter    = "[Start] >= '$start_str' AND [Start] < '$end_str'"
            $filtered  = $items.Restrict($filter)

            $meetings = @()
            foreach ($item in $filtered) {
                $joinUrl  = $null
                $loc      = try { $item.Location } catch { '' }
                $body     = try { $item.Body     } catch { '' }
                $subject  = try { $item.Subject  } catch { '(no title)' }
                $startStr = $item.Start.ToString('o')
                $endStr   = $item.End.ToString('o')

                if (("$loc $body") -match 'https://teams\.microsoft\.com/[^\s"<>]+') {
                    $joinUrl = $matches[0] -replace '&amp;','&'
                }

                $meetings += [ordered]@{
                    subject  = $subject
                    start    = $startStr
                    end      = $endStr
                    location = $loc
                    joinUrl  = $joinUrl
                }
            }

            $json  = ConvertTo-Json -InputObject $meetings -Compress -Depth 3
            if (-not $json) { $json = '[]' }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.ContentType     = 'application/json; charset=utf-8'
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $msg   = $_.Exception.Message -replace '"',"'"
            $err   = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$msg`"}")
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
