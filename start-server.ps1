$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$allowed = "work-log.html"

# Find a free port on localhost only
$port = 8080
while ($port -lt 8200) {
    $test = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    try { $test.Start(); $test.Stop(); break } catch { $port++ }
}

$url = "http://127.0.0.1:$port/"
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Start-Process "$($url)work-log.html"
Write-Host "Work log running at $($url)work-log.html"
Write-Host "Close this window to stop the server."

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # Only serve work-log.html — everything else gets 404
    $requested = $req.Url.LocalPath.TrimStart('/')
    if ($requested -eq '' -or $requested -eq $allowed) {
        $file = Join-Path $root $allowed
        if (Test-Path $file -PathType Leaf) {
            $bytes = [IO.File]::ReadAllBytes($file)
            $res.ContentType = 'text/html; charset=utf-8'
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
    } else {
        $res.StatusCode = 404
    }
    $res.Close()
}
