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

    # ICS calendar proxy — fetches the calendar URL server-side to bypass CORS
    if ($req.Url.LocalPath -eq '/api/ics') {
        try {
            $icsUrl = [System.Web.HttpUtility]::UrlDecode($req.QueryString['url'])
            if (-not $icsUrl) { throw 'No URL provided' }

            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (compatible; WorkLog/1.0)')
            $content = $wc.DownloadString($icsUrl)

            $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
            $res.ContentType       = 'text/calendar; charset=utf-8'
            $res.ContentLength64   = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $err   = [System.Text.Encoding]::UTF8.GetBytes("ERROR: $_")
            $res.StatusCode        = 500
            $res.ContentType       = 'text/plain'
            $res.ContentLength64   = $err.Length
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
