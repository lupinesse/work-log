#Requires -Modules Pester
<#
.SYNOPSIS
    Regression tests for the POST /api/gofore-timesheet guard (#476).

.DESCRIPTION
    Covers the two protections the route handler in start-server.ps1 delegates to
    Get-GoforeRequestDecision: the server-side feature gate, and rejection of
    cross-origin / non-local requests. The decision is pure (headers in, verdict
    out), so no listener or browser is started.
#>

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $here
. (Join-Path $repoRoot 'server-helpers.ps1')

function Get-Decision {
    param($Enabled = $true, $Origin = 'http://localhost:8080', $HostHeader = 'localhost:8080')
    Get-GoforeRequestDecision -Enabled $Enabled -Origin $Origin -HostHeader $HostHeader -Port 8080
}

Describe 'Test-GoforeSubmitEnabled' {
    It 'is true only for a real boolean $true' {
        Test-GoforeSubmitEnabled $true | Should Be $true
    }

    foreach ($value in @($false, $null, 'true', 'false', 1, '')) {
        It "is false for $(if ($null -eq $value) { '$null' } else { "'$value' ($($value.GetType().Name))" })" {
            Test-GoforeSubmitEnabled $value | Should Be $false
        }
    }
}

Describe 'Get-GoforeRequestDecision: feature gate' {
    It 'refuses with 403 when submission is disabled (the default)' {
        $decision = Get-Decision -Enabled $false
        $decision.Allowed | Should Be $false
        $decision.Status  | Should Be 403
        $decision.Error   | Should Match 'disabled'
    }

    It 'refuses when the setting is unset' {
        (Get-Decision -Enabled $null).Allowed | Should Be $false
    }

    It 'refuses a quoted "false", which is truthy in PowerShell' {
        (Get-Decision -Enabled 'false').Allowed | Should Be $false
    }

    It 'allows a same-origin request once enabled' {
        $decision = Get-Decision -Enabled $true
        $decision.Allowed | Should Be $true
        $decision.Status  | Should Be 200
    }
}

Describe 'Get-GoforeRequestDecision: cross-origin protection' {
    $rejectedOrigins = @(
        'https://evil.example',
        'http://evil.example:8080',
        'http://localhost:9999',
        'http://localhost',
        'https://localhost:8080',
        'http://localhost.evil.example:8080',
        'null'
    )
    foreach ($origin in $rejectedOrigins) {
        It "rejects Origin '$origin' even when submission is enabled" {
            $decision = Get-Decision -Enabled $true -Origin $origin
            $decision.Allowed | Should Be $false
            $decision.Status  | Should Be 403
            $decision.Reason  | Should Match 'origin'
        }
    }

    foreach ($origin in @('http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'HTTP://LOCALHOST:8080')) {
        It "accepts own Origin '$origin'" {
            (Get-Decision -Origin $origin -HostHeader 'localhost:8080').Allowed | Should Be $true
        }
    }

    It 'allows a request with no Origin (non-browser client)' {
        (Get-Decision -Origin $null).Allowed | Should Be $true
        (Get-Decision -Origin '').Allowed     | Should Be $true
    }

    It 'rejects a DNS-rebinding Host even with no Origin' {
        $decision = Get-Decision -Origin $null -HostHeader 'attacker.example:8080'
        $decision.Allowed | Should Be $false
        $decision.Reason  | Should Match 'host'
    }

    foreach ($missingHost in @($null, '')) {
        It "rejects a missing Host header ($(if ($null -eq $missingHost) { '$null' } else { 'empty' })) with 403 and a host reason" {
            $decision = Get-Decision -HostHeader $missingHost
            $decision.Allowed | Should Be $false
            $decision.Status  | Should Be 403
            $decision.Error   | Should Match 'localhost'
            $decision.Reason  | Should Match 'host'
        }
    }

    It 'reports the origin failure before the disabled failure' {
        (Get-Decision -Enabled $false -Origin 'https://evil.example').Reason | Should Match 'origin'
    }
}

Describe 'start-server.ps1 wiring' {
    $source = Get-Content -Path (Join-Path $repoRoot 'start-server.ps1') -Raw

    It 'no longer sends a wildcard Access-Control-Allow-Origin' {
        $source | Should Not Match 'Access-Control-Allow-Origin'
    }

    It 'consults Get-GoforeRequestDecision before running the timesheet script' {
        $routeStart = $source.IndexOf("'/api/gofore-timesheet'")
        $guard      = $source.IndexOf('Get-GoforeRequestDecision', $routeStart)
        $invoke     = $source.IndexOf('Invoke-GoforeTimesheet -Json', $routeStart)
        ($guard -gt $routeStart) | Should Be $true
        ($guard -lt $invoke)     | Should Be $true
    }

    It 'defaults $GoforeSubmitEnabled to $false before config.local.ps1 loads' {
        $source | Should Match '\$GoforeSubmitEnabled = \$false'
    }
}
