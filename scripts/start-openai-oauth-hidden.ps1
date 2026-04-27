param(
  [switch] $StopDuplicatePorts
)

$ErrorActionPreference = 'Stop'

$AppDir = Join-Path $env:LOCALAPPDATA 'LocalSubtitleTranslator'
$LogPath = Join-Path $AppDir 'openai-oauth.log'
$PidPath = Join-Path $AppDir 'openai-oauth.pid'
$PreferredPort = 10531
$KnownPorts = @(10531, 10532)

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

function Get-ListenerProcesses {
  param([int[]] $Ports)

  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process) {
          [pscustomobject]@{
            Port = $port
            ProcessId = [int] $process.ProcessId
            CommandLine = [string] $process.CommandLine
          }
        }
      }
  }
}

function Test-OpenAIOAuthProcess {
  param([string] $CommandLine)
  return $CommandLine -match 'openai-oauth'
}

if ($StopDuplicatePorts) {
Get-ListenerProcesses -Ports $KnownPorts |
    Where-Object {
      $_.Port -ne $PreferredPort -and
      (Test-OpenAIOAuthProcess -CommandLine $_.CommandLine)
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$preferredListener = Get-ListenerProcesses -Ports @($PreferredPort) | Select-Object -First 1
if ($preferredListener) {
  if (Test-OpenAIOAuthProcess -CommandLine $preferredListener.CommandLine) {
    Set-Content -Path $PidPath -Value $preferredListener.ProcessId -Encoding ascii
    Write-Host "openai-oauth is already running on port $PreferredPort. PID: $($preferredListener.ProcessId)"
    exit 0
  }

  Write-Error "Port $PreferredPort is already used by another process. PID: $($preferredListener.ProcessId)"
  exit 1
}

$command = @"
npx -y openai-oauth *> "$LogPath"
"@

$process = Start-Process `
  -FilePath (Join-Path $PSHOME 'powershell.exe') `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
  -WindowStyle Hidden `
  -PassThru

Set-Content -Path $PidPath -Value $process.Id -Encoding ascii
Start-Sleep -Seconds 2

$newListener = Get-ListenerProcesses -Ports @($PreferredPort) | Select-Object -First 1
if ($newListener -and (Test-OpenAIOAuthProcess -CommandLine $newListener.CommandLine)) {
  Write-Host "openai-oauth started hidden on port $PreferredPort. PID: $($newListener.ProcessId)"
  exit 0
}

Write-Warning "openai-oauth was started hidden, but port $PreferredPort is not listening yet."
Write-Warning "Log: $LogPath"
