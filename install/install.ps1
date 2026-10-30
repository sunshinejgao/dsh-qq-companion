# 把人格卡、MCP 工具、军师 skill 装到位
# 用法：powershell -ExecutionPolicy Bypass -File install/install.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env'

function Read-Env($key, $default = $null) {
  if (-not (Test-Path $envFile)) { return $default }
  $t = Get-Content $envFile -Raw -Encoding UTF8
  if ($t -match "(?m)^\s*$key\s*=\s*(.+)$") { return $Matches[1].Trim() }
  return $default
}

$bridgeDir = Read-Env 'QQ_BRIDGE_DIR'
if (-not $bridgeDir -or -not (Test-Path $bridgeDir)) {
  Write-Host "QQ_BRIDGE_DIR 没配或不存在，先跑 check-prereqs.ps1" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== 1/4 安装人格卡 ===" -ForegroundColor Cyan
$rolesDir = Join-Path $bridgeDir 'roles'
New-Item -ItemType Directory -Path $rolesDir -Force | Out-Null
Copy-Item (Join-Path $repo 'roles\肥嘟嘟.md') $rolesDir -Force
Write-Host "  已复制到 $rolesDir"

Write-Host "`n=== 2/4 设为当前角色 ===" -ForegroundColor Cyan
$stateDir = Join-Path $bridgeDir 'state'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$roleState = '{"role":"肥嘟嘟","mode":"active"}'
[System.IO.File]::WriteAllText((Join-Path $stateDir 'current-role.json'), $roleState, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  state/current-role.json -> 肥嘟嘟"

Write-Host "`n=== 3/4 注册 MCP 工具 ===" -ForegroundColor Cyan
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profiles = Get-ChildItem (Join-Path $dshHome 'profiles') -Directory -ErrorAction SilentlyContinue
$patched = $false
foreach ($p in $profiles) {
  $file = Join-Path $p.FullName 'cordis.patch.yml'
  if (-not (Test-Path $file)) { continue }
  $text = Get-Content $file -Raw -Encoding UTF8
  if ($text -match 'mcp-diary') {
    Write-Host "  $($p.Name) 里已有 mcp-diary，跳过"
    $patched = $true
    continue
  }
  $block = @"

# === dsh-qq-companion：diary / 语音 / 点歌 / 提醒 / 军师 ===
# ⚠️ 放在 qq-bridge MCP BEGIN/END 区块之外，否则会被 setup-dsh.mjs 冲掉
- insert:
    - id: mcp-diary
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: diary
        transport: stdio
        command: node
        args:
          - '$($repo -replace '\\','/')/src/mcp-diary.js'
        toolCallTimeoutMs: 430000
"@
  Add-Content -Path $file -Value $block -Encoding UTF8 -NoNewline
  Write-Host "  已写入 $($p.Name)/cordis.patch.yml"
  $patched = $true
}
if (-not $patched) { Write-Host "  没找到 DSH profile，手动把 config/cordis.patch.example.yml 的内容加进去" -ForegroundColor Yellow }

Write-Host "`n=== 4/4 安装军师 skill ===" -ForegroundColor Cyan
$skillsDir = Join-Path $dshHome 'skills'
New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
$dest = Join-Path $skillsDir 'goutoujunshi'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item (Join-Path $repo 'vendor\goutoujunshi') $dest -Recurse -Force
Write-Host "  已安装到 $dest"

Write-Host "`n完成。重启 DSH 后 MCP 工具才会生效。" -ForegroundColor Green
Write-Host "下一步：register-tasks.ps1" -ForegroundColor Green
