param(
    [Parameter(Mandatory = $true)]
    [string] $PackageZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$zip = (Resolve-Path -LiteralPath $PackageZip).Path
$scratch = Join-Path $env:RUNNER_TEMP ("KuKLA smoke " + [guid]::NewGuid().ToString('N'))
$install = Join-Path $scratch 'Папка с пробелами\Клиент KuKLA'
New-Item -ItemType Directory -Path $install -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $install

$required = @(
    'KuKLA.exe', 'README.txt', 'LICENSE.txt',
    'bin\kukla-ui.exe', 'bin\kukla-engine.exe',
    'bin\gspawn-win64-helper.exe', 'bin\gspawn-win64-helper-console.exe',
    'share\glib-2.0\schemas\gschemas.compiled',
    'share\icons\Adwaita\index.theme', 'share\icons\hicolor\index.theme',
    'lib\gdk-pixbuf-2.0\2.10.0\loaders.cache'
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $install $path) -PathType Leaf)) {
        throw "The portable archive is missing $path"
    }
}
$cache = Get-Content -LiteralPath (Join-Path $install 'lib\gdk-pixbuf-2.0\2.10.0\loaders.cache')
$loaderCount = 0
foreach ($line in $cache) {
    if ($line -match '^\s*"([^"]+\.dll)"\s*$') {
        $loader = $Matches[1] -replace '\\\\', '\'
        if ([System.IO.Path]::IsPathRooted($loader) -or
            -not (Test-Path -LiteralPath (Join-Path $install $loader) -PathType Leaf)) {
            throw "Non-relocatable or missing GdkPixbuf loader in cache: $loader"
        }
        $loaderCount++
    }
}
if ($loaderCount -eq 0) { throw 'The GdkPixbuf loader cache is empty.' }

# Simulate a clean user's machine: the MSYS2 compiler and GTK installation are
# not on PATH. Keep all test data outside the package and in a temporary profile.
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
$env:APPDATA = Join-Path $scratch 'roaming-data'
$env:LOCALAPPDATA = Join-Path $scratch 'local-data'
Remove-Item Env:GTK_DATA_PREFIX, Env:GTK_EXE_PREFIX, Env:GSETTINGS_SCHEMA_DIR, `
    Env:GDK_PIXBUF_MODULEDIR, Env:GDK_PIXBUF_MODULE_FILE, Env:XDG_DATA_DIRS `
    -ErrorAction SilentlyContinue
$launcherPath = Join-Path $install 'KuKLA.exe'
$uiPath = Join-Path $install 'bin\kukla-ui.exe'
$enginePath = Join-Path $install 'bin\kukla-engine.exe'
$script:launchers = @()

function Invoke-EngineRequest {
    param([string] $PipeName, [string] $Method, [string] $Path, [string] $Body = '')
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new(
        '.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut,
        [System.IO.Pipes.PipeOptions]::None)
    try {
        $pipe.Connect(2000)
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $headers = "$Method $Path HTTP/1.1`r`nHost: localhost`r`nContent-Type: application/json`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
        $pipe.Write($headerBytes, 0, $headerBytes.Length)
        if ($bodyBytes.Length -gt 0) { $pipe.Write($bodyBytes, 0, $bodyBytes.Length) }
        $pipe.Flush()
        $reader = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8, $false, 1024, $true)
        try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $pipe.Dispose() }

    $boundary = $raw.IndexOf("`r`n`r`n")
    $statusMatch = [regex]::Match($raw, '^HTTP/1\.[01] (\d{3})')
    if ($boundary -lt 0 -or -not $statusMatch.Success) {
        throw "Invalid HTTP response from the local engine: $raw"
    }
    return [pscustomobject]@{
        Status = [int]$statusMatch.Groups[1].Value
        Body = $raw.Substring($boundary + 4)
    }
}

function Start-Client {
    # Start from another working directory to verify that the launcher relocates
    # its resources, including when the package path contains spaces and Cyrillic.
    $launcher = Start-Process -FilePath $launcherPath -WorkingDirectory $scratch -PassThru
    $script:launchers += $launcher
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    $lastError = 'UI or engine process was not found'
    do {
        if ($launcher.HasExited) {
            throw "KuKLA.exe exited during startup with code $($launcher.ExitCode)"
        }
        $uiInfo = Get-CimInstance Win32_Process -Filter "Name = 'kukla-ui.exe'" |
            Where-Object { $_.ExecutablePath -ieq $uiPath -and $_.ParentProcessId -eq $launcher.Id } |
            Select-Object -First 1
        $engineInfo = Get-CimInstance Win32_Process -Filter "Name = 'kukla-engine.exe'" |
            Where-Object { $_.ExecutablePath -ieq $enginePath } | Select-Object -First 1
        if ($uiInfo -and $engineInfo -and $engineInfo.CommandLine -match '(kukla-engine-[0-9a-fA-F-]{36})') {
            $pipeName = $Matches[1]
            try {
                $health = Invoke-EngineRequest $pipeName 'GET' '/v1/health'
                $ui = Get-Process -Id $uiInfo.ProcessId -ErrorAction Stop
                $ui.Refresh()
                if ($health.Status -eq 200 -and $ui.MainWindowHandle -ne [IntPtr]::Zero) {
                    return [pscustomobject]@{
                        Launcher = $launcher
                        UI = $ui
                        EngineId = [int]$engineInfo.ProcessId
                        PipeName = $pipeName
                    }
                }
                $lastError = 'Engine health or UI window not ready'
            } catch {
                $lastError = $_.Exception.Message
            }
        }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "KuKLA did not become ready: $lastError"
}

function Stop-Client {
    param($Client)
    $Client.UI.Refresh()
    if (-not $Client.UI.CloseMainWindow()) { throw 'Failed to close the KuKLA window.' }
    if (-not $Client.Launcher.WaitForExit(20000)) { throw 'The launcher did not exit after the UI was closed.' }
    if ($Client.Launcher.ExitCode -ne 0) { throw "The UI exited with code $($Client.Launcher.ExitCode)." }
    $engine = Get-Process -Id $Client.EngineId -ErrorAction SilentlyContinue
    if ($engine -and -not $engine.WaitForExit(15000)) { throw 'The local engine did not stop on window close.' }
}

try {
    $client = Start-Client
    $search = Invoke-EngineRequest $client.PipeName 'POST' '/v1/searches' '{"title":"Windows package smoke test"}'
    if ($search.Status -ne 201) { throw "Creating a search failed: $($search.Status) $($search.Body)" }
    $searchId = ($search.Body | ConvertFrom-Json).id
    $profile = Invoke-EngineRequest $client.PipeName 'PUT' '/v1/me/profile' `
        '{"full_name":"Windows test","skills":[],"consent_personal_data":true}'
    if ($profile.Status -ne 200) { throw "Saving the profile failed: $($profile.Status) $($profile.Body)" }
    Stop-Client $client

    $client = Start-Client
    $searches = Invoke-EngineRequest $client.PipeName 'GET' '/v1/searches'
    if ($searches.Status -ne 200 -or -not (($searches.Body | ConvertFrom-Json).id -contains $searchId)) {
        throw 'The search was not persisted after restarting the client.'
    }
    $savedProfile = Invoke-EngineRequest $client.PipeName 'GET' '/v1/me/profile'
    if ($savedProfile.Status -ne 200 -or ($savedProfile.Body | ConvertFrom-Json).full_name -ne 'Windows test') {
        throw 'The profile was not persisted after restarting the client.'
    }
    Stop-Client $client
    Write-Host 'Portable Windows package passed clean-path startup, IPC, persistence and shutdown checks.'
} finally {
    foreach ($path in @($uiPath, $enginePath)) {
        $name = [System.IO.Path]::GetFileName($path)
        Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -ieq $path } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    foreach ($launcher in $script:launchers) {
        if (-not $launcher.HasExited) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
