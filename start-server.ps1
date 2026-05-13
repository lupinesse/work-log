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
