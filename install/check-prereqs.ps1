# 依赖检查：缺什么直接说缺什么
# 用法：powershell -ExecutionPolicy Bypass -File install/check-prereqs.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$fail = 0

function Ok($msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [warn] $msg" -ForegroundColor Yellow }
function Bad($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:fail++ }

Write-Host "`n=== dsh-qq-companion 依赖检查 ===`n" -ForegroundColor Cyan

# ---- .env ----
Write-Host "配置"
$envFile = Join-Path $repo '.env'
if (-not (Test-Path $envFile)) {
  Bad "缺少 .env（复制 .env.example 后填好）"
} else {
  Ok ".env 存在"
  $envText = Get-Content $envFile -Raw -Encoding UTF8
  foreach ($k in 'QQ_BRIDGE_DIR','DSH_EXE','PY_RVC','PY_CORE','FFMPEG') {
    if ($envText -match "(?m)^\s*$k\s*=\s*(.+)$") {
      $v = $Matches[1].Trim()
      if ($v -like '<*') { Bad "$k 还是占位符" }
      elseif (-not (Test-Path $v) -and $v -notmatch '^\w+$') { Bad "$k 指向的路径不存在：$v" }
      else { Ok "$k = $v" }
    } else { Warn "$k 没配置（用默认值）" }
  }
}

# ---- Node ----
Write-Host "`n运行时"
if (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (node --version) -replace 'v',''
  if ([int]($v.Split('.')[0]) -ge 20) { Ok "Node $v" } else { Bad "Node $v 太旧（需要 20+）" }
} else { Bad "没装 Node.js" }

if (Get-Command git -ErrorAction SilentlyContinue) { Ok "git $((git --version) -replace 'git version ','')" } else { Warn "没装 git" }

# ---- Python ----
foreach ($pair in @(@{k='PY_RVC'; n='RVC 环境'}, @{k='PY_CORE'; n='基础环境'})) {
  $v = $null
  if ($envText -match "(?m)^\s*$($pair.k)\s*=\s*(.+)$") { $v = $Matches[1].Trim() }
  if ($v -and (Test-Path $v)) {
    $ver = & $v --version 2>&1
    Ok "$($pair.n)：$ver"
  } else { Bad "$($pair.n) 不可用（$($pair.k)）" }
}

# ---- ffmpeg ----
$ff = $null
if ($envText -match "(?m)^\s*FFMPEG\s*=\s*(.+)$") { $ff = $Matches[1].Trim() }
if ($ff -and (Test-Path $ff)) {
  $ver = (& $ff -version 2>&1 | Select-Object -First 1)
  Ok "ffmpeg：$ver"
} else { Bad "ffmpeg 不可用" }

# ---- 端口 ----
Write-Host "`n服务端口"
$ports = @{ 3000='SnowLuma HTTP'; 3001='SnowLuma WS'; 3100='qq-bridge'; 8127='RVC 服务' }
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
foreach ($p in $ports.Keys | Sort-Object) {
  if ($listen | Where-Object { $_.LocalPort -eq $p }) { Ok "$p $($ports[$p]) 在监听" }
  else { Warn "$p $($ports[$p]) 没起来" }
}

# ---- 模型 ----
Write-Host "`n模型"
$modelsDir = Join-Path $repo 'voice-models'
if ($envText -match "(?m)^\s*RVC_MODELS_DIR\s*=\s*(.+)$") { $modelsDir = $Matches[1].Trim() }
if (Test-Path $modelsDir) {
  $dirs = Get-ChildItem $modelsDir -Directory -ErrorAction SilentlyContinue
  if ($dirs) {
    foreach ($d in $dirs) {
      $pth = Get-ChildItem $d.FullName -Filter *.pth -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($pth) { Ok "音色 $($d.Name)（$([math]::Round($pth.Length/1MB)) MB）" } else { Warn "音色目录 $($d.Name) 里没有 .pth" }
    }
  } else { Warn "voice-models 里没有任何音色目录" }
} else { Warn "没有 voice-models 目录（翻唱/语音会失败）" }

# ---- 豆包凭据 ----
$cred = Join-Path $repo 'volc-app.json'
if ($envText -match "(?m)^\s*VOLC_CRED\s*=\s*(.+)$") { $cred = $Matches[1].Trim() }
elseif ($envText -match "(?m)^\s*QQ_BRIDGE_DIR\s*=\s*(.+)$") { $cred = Join-Path $Matches[1].Trim() 'volc-app.json' }
if (Test-Path $cred) { Ok "豆包凭据存在" } else { Warn "没有 volc-app.json（语音合成会失败）" }

# ---- 洛雪 ----
$cdp = $null
try { $cdp = Invoke-RestMethod 'http://127.0.0.1:9222/json/list' -TimeoutSec 3 } catch {}
if ($cdp) { Ok "洛雪 CDP 可用（$($cdp.Count) 个页面）" } else { Warn "洛雪 CDP 连不上（翻唱下载会失败；需要 --remote-debugging-port=9222 启动）" }

Write-Host ""
if ($fail -eq 0) { Write-Host "全部通过。" -ForegroundColor Green }
else { Write-Host "$fail 项未通过，先修这些再继续。" -ForegroundColor Red; exit 1 }
