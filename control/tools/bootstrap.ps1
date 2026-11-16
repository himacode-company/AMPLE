# AMPLE first-time setup on ANY Windows 10/11 PC — nothing needs to be installed first.
# Started by setup.cmd. Steps:
#   1. portable Node.js -> control\runtime\node.exe   (official zip, SHA-256 checked)
#   2. Visual C++ runtime check (Apache and PHP need it) -> offers Microsoft's installer
#   3. ample setup  (Apache, PHP, MariaDB, phpMyAdmin, Mailpit, Composer, certificates)
#   4. ample check  (is this PC ready?)
#   5. ample panel  (the control panel opens on its welcome screen)
param([switch]$Unattended)   # -Unattended: no questions (used for automated tests)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
function Say($m) { Write-Host "  $m" }

Write-Host "`nAMPLE setup  ($root)`n" -ForegroundColor Cyan

# --- 1. Node.js (runs AMPLE itself) ---------------------------------------------
$comp = (Get-Content (Join-Path $root 'control\components.json') -Raw | ConvertFrom-Json).node
$nodeExe = Join-Path $root 'control\runtime\node.exe'
$have = if (Test-Path $nodeExe) { (& $nodeExe -v) } else { $null }
if ($have -ne "v$($comp.version)") {
    Write-Host "1. Node.js $($comp.version) (portable, only for AMPLE)"
    $dl = Join-Path $root 'tmp\downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
    $zip = Join-Path $dl ([IO.Path]::GetFileName($comp.url))
    if (-not (Test-Path $zip)) { Say "downloading $($comp.url)"; Invoke-WebRequest $comp.url -OutFile "$zip.part" -UseBasicParsing; Move-Item "$zip.part" $zip -Force }
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($sha -ne $comp.sha256) { Remove-Item $zip; throw "Checksum mismatch for Node.js (expected $($comp.sha256), got $sha)" }
    Say 'checksum OK'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $entry = $z.Entries | Where-Object { $_.FullName -eq $comp.file }
        New-Item -ItemType Directory -Force (Split-Path $nodeExe) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $nodeExe, $true)
    } finally { $z.Dispose() }
    Say ("installed " + (& $nodeExe -v))
} else { Write-Host "1. Node.js $have already here" }

# --- 2. Visual C++ runtime -------------------------------------------------------
$vc = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue).Version
$vcOk = $vc -and ([version]($vc.TrimStart('v')) -ge [version]'14.30')
if ($vcOk) { Write-Host "2. Visual C++ runtime $vc already here" }
else {
    Write-Host "2. Visual C++ runtime: $(if ($vc) { "$vc is too old" } else { 'missing' }) (Apache and PHP need it)"
    $url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
    $go = $Unattended -or ((Read-Host "   Download and install it from Microsoft now? Windows will ask for permission (Y/n)") -notmatch '^[nN]')
    if ($go) {
        $exe = Join-Path $env:TEMP 'vc_redist.x64.exe'
        Invoke-WebRequest $url -OutFile $exe -UseBasicParsing
        $sig = Get-AuthenticodeSignature $exe
        if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw 'The Visual C++ installer is not signed by Microsoft; not running it.' }
        Say 'signed by Microsoft: OK, installing...'
        $p = Start-Process $exe -ArgumentList '/install', '/passive', '/norestart' -Verb RunAs -Wait -PassThru
        Say "installer finished (exit $($p.ExitCode))"
    } else { Say "skipped. Install it later from $url" }
}

# --- 3 + 4. components and system check ----------------------------------------------
Write-Host "3. Components (Apache, PHP, MariaDB, phpMyAdmin, Mailpit, Composer)"
& $nodeExe (Join-Path $root 'control\cli\ample.js') setup
if ($LASTEXITCODE -ne 0) { throw 'ample setup failed (see the messages above)' }
Write-Host "`n4. Checking this PC"
& $nodeExe (Join-Path $root 'control\cli\ample.js') check
Write-Host "`nDone. Start everything with:  ample start   (in this folder)`n" -ForegroundColor Green
# 5. open the control panel: its welcome screen offers the shortcuts and the last choices
if (-not $Unattended) {
    Write-Host "Opening the AMPLE control panel..."
    & $nodeExe (Join-Path $root 'control\cli\ample.js') panel
}
