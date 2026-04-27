param(
  [int[]] $Ports = @(10531, 10532)
)

$ErrorActionPreference = 'Stop'

$AppDir = Join-Path $env:LOCALAPPDATA 'LocalSubtitleTranslator'
$PidPath = Join-Path $AppDir 'openai-oauth.pid'

function Get-OpenAIOAuthListeners {
  param([int[]] $Ports)

  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and ([string] $process.CommandLine) -match 'openai-oauth') {
          [pscustomobject]@{
            Port = $port
            ProcessId = [int] $process.ProcessId
          }
        }
      }
  }
}

$listeners = @(Get-OpenAIOAuthListeners -Ports $Ports)

if ($listeners.Count -eq 0) {
  Write-Host 'No openai-oauth listener was found.'
} else {
  $listeners |
    Sort-Object ProcessId -Unique |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped openai-oauth PID $($_.ProcessId)."
    }
}

if (Test-Path $PidPath) {
  Remove-Item -LiteralPath $PidPath -Force
}
