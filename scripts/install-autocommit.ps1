# Устанавливает постоянный сторож автокоммита: задача Windows, стартующая
# при входе в систему. Запуск вручную:  powershell -ExecutionPolicy Bypass -File scripts\install-autocommit.ps1
$ErrorActionPreference = 'Stop'

$TaskName = 'SunsetDistrictAutoCommit'
$Script = Join-Path $PSScriptRoot 'autocommit.mjs'
$Node = (Get-Command node -ErrorAction Stop).Source
$Project = Split-Path -Parent $PSScriptRoot

Write-Output "node:   $Node"
Write-Output "скрипт: $Script"

$action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Сторож автокоммита Sunset District: коммит после каждой серии правок + push в main" -Force | Out-Null
  Write-Output "задача '$TaskName' зарегистрирована (запуск при входе)"
} catch {
  Write-Warning "Register-ScheduledTask не сработал: $($_.Exception.Message)"
  Write-Output "Пробую папку автозагрузки..."
  $startup = [Environment]::GetFolderPath('Startup')
  $shortcut = Join-Path $startup 'SunsetDistrictAutoCommit.cmd'
  $lines = @(
    '@echo off',
    ('start "" /min "' + $Node + '" "' + $Script + '"')
  )
  Set-Content -Path $shortcut -Value $lines -Encoding ASCII
  Write-Output "добавлено в автозагрузку: $shortcut"
}

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
  Select-Object TaskName, State | Format-List

$pidFile = Join-Path $Project '.git\autocommit.pid'
if (Test-Path $pidFile) {
  Write-Output "сторож запущен, pid: $(Get-Content $pidFile)"
} else {
  Write-Output "pid-файл не найден — проверьте .git\autocommit.log"
}
