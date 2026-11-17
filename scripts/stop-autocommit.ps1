# Останавливает сторож автокоммита: снимает задачу Windows и убивает процесс node.
# Запуск:  powershell -ExecutionPolicy Bypass -File scripts\stop-autocommit.ps1
$ErrorActionPreference = 'Continue'

$TaskName = 'SunsetDistrictAutoCommit'
$Project = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $Project '.git\autocommit.pid'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Output "задача '$TaskName' остановлена"
  Write-Output "чтобы сторож не запускался при входе: Disable-ScheduledTask -TaskName '$TaskName'"
} else {
  Write-Output "задача '$TaskName' не найдена"
}

if (Test-Path $pidFile) {
  $watcherPid = [int](Get-Content $pidFile -Raw).Trim()
  try {
    Stop-Process -Id $watcherPid -Force -ErrorAction Stop
    Write-Output "процесс сторожа (pid $watcherPid) остановлен"
  } catch {
    Write-Output "процесс $watcherPid уже не работает"
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
