param(
  [switch] $StopDuplicatePorts
)

$ErrorActionPreference = 'Stop'

$AppDir = Join-Path $env:LOCALAPPDATA 'Open_Translator'
$LogPath = Join-Path $AppDir 'openai-oauth.log'
$PidPath = Join-Path $AppDir 'openai-oauth.pid'
$CandidatePorts = @(10531, 10532)

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
  @(Get-ListenerProcesses -Ports $CandidatePorts |
    Where-Object { Test-OpenAIOAuthProcess -CommandLine $_.CommandLine } |
    Sort-Object Port |
    Select-Object -Skip 1) |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$listeners = @(Get-ListenerProcesses -Ports $CandidatePorts)
$existingProxy = $listeners |
  Where-Object { Test-OpenAIOAuthProcess -CommandLine $_.CommandLine } |
  Select-Object -First 1

if ($existingProxy) {
  Set-Content -Path $PidPath -Value $existingProxy.ProcessId -Encoding ascii
  Write-Host "openai-oauth is already running on port $($existingProxy.Port). PID: $($existingProxy.ProcessId)"
  exit 0
}

$busyPorts = @($listeners | Select-Object -ExpandProperty Port)
$selectedPort = $CandidatePorts |
  Where-Object { $busyPorts -notcontains $_ } |
  Select-Object -First 1

if (-not $selectedPort) {
  $busyText = ($listeners | ForEach-Object { "port $($_.Port) PID $($_.ProcessId)" }) -join ', '
  Write-Error "Ports 10531 and 10532 are already used by other processes. $busyText"
  exit 1
}

$command = @"
npx -y openai-oauth --port $selectedPort *> "$LogPath"
"@

$process = Start-Process `
  -FilePath (Join-Path $PSHOME 'powershell.exe') `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
  -WindowStyle Hidden `
  -PassThru

Set-Content -Path $PidPath -Value $process.Id -Encoding ascii
Start-Sleep -Seconds 2

$newListener = Get-ListenerProcesses -Ports @($selectedPort) | Select-Object -First 1
if ($newListener -and (Test-OpenAIOAuthProcess -CommandLine $newListener.CommandLine)) {
  Write-Host "openai-oauth started hidden on port $selectedPort. PID: $($newListener.ProcessId)"
  exit 0
}

Write-Warning "openai-oauth was started hidden, but port $selectedPort is not listening yet."
Write-Warning "Log: $LogPath"
