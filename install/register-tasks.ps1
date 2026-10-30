# 注册两个计划任务：日记（每天 23:30）、提醒（每分钟）
# 用法：powershell -ExecutionPolicy Bypass -File install/register-tasks.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env'

function Read-Env($key, $default = $null) {
  if (-not (Test-Path $envFile)) { return $default }
  $t = Get-Content $envFile -Raw -Encoding UTF8
  if ($t -match "(?m)^\s*$key\s*=\s*(.+)$") { return $Matches[1].Trim() }
  return $default
}

$dsh = Read-Env 'DSH_EXE'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "找不到 node" -ForegroundColor Red; exit 1 }

# ---- 生成两个启动脚本（纯 ASCII，避免 cmd 读中文乱码） ----
$runDiary = @"
@echo off
setlocal
cd /d "$repo"
set "ELECTRON_RUN_AS_NODE=1"
"$dsh" "$repo\src\tools\diary.mjs" --write --publish --right 1 >> "$repo\src\tools\diary-cron.log" 2>&1
"@
$runReminder = @"
@echo off
setlocal
cd /d "$repo"
"$node" "$repo\src\tools\reminder-tick.mjs" >> "$repo\src\tools\reminders.log" 2>&1
"@
[System.IO.File]::WriteAllText("$repo\scripts\run-diary.cmd", $runDiary, (New-Object System.Text.ASCIIEncoding))
[System.IO.File]::WriteAllText("$repo\scripts\run-reminder.cmd", $runReminder, (New-Object System.Text.ASCIIEncoding))
Write-Host "已生成 scripts/run-diary.cmd 和 scripts/run-reminder.cmd"

# ---- 注册 ----
schtasks /delete /tn 'dsh-qq-日记' /f 2>$null | Out-Null
schtasks /delete /tn 'dsh-qq-提醒' /f 2>$null | Out-Null

schtasks /create /tn 'dsh-qq-日记' /tr "cmd /c `"$repo\scripts\run-diary.cmd`"" /sc daily /st 23:30 /f
schtasks /create /tn 'dsh-qq-提醒' /tr "cmd /c `"$repo\scripts\run-reminder.cmd`"" /sc minute /mo 1 /f

Write-Host "`n已注册：" -ForegroundColor Green
schtasks /query /tn 'dsh-qq-日记' /fo LIST | Select-String '任务名|下次运行时间'
schtasks /query /tn 'dsh-qq-提醒' /fo LIST | Select-String '任务名|下次运行时间'
