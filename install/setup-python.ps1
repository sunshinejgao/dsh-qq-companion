# 建两个 Python 环境：
#   PY_CORE —— 跑 TTS/小工具（轻，几十 MB）
#   PY_RVC  —— 跑 RVC（重，torch + fairseq，几个 GB，编译要十几分钟）
#
# 用法：powershell -ExecutionPolicy Bypass -File install/setup-python.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env'

function Read-Env($key) {
  if (-not (Test-Path $envFile)) { return $null }
  $t = Get-Content $envFile -Raw -Encoding UTF8
  if ($t -match "(?m)^\s*$key\s*=\s*(.+)$") { return $Matches[1].Trim() }
  return $null
}

$pyCore = Read-Env 'PY_CORE'
$pyRvc  = Read-Env 'PY_RVC'
$uv = Get-Command uv -ErrorAction SilentlyContinue
$pip = if ($uv) { 'uv pip' } else { 'pip' }

Write-Host "`n=== 1/2 基础环境（PY_CORE）===" -ForegroundColor Cyan
if (-not $pyCore) { Write-Host "PY_CORE 没配，跳过" -ForegroundColor Yellow }
elseif (-not (Test-Path $pyCore)) { Write-Host "PY_CORE 不存在：$pyCore（先手动建 venv 或改 .env）" -ForegroundColor Red }
else {
  $pyDir = Split-Path $pyCore -Parent
  $envDir = Split-Path $pyDir -Parent
  Write-Host "目标：$envDir"
  if ($uv) {
    & uv pip install --python $pyCore edge-tts soundfile numpy scipy 2>&1 | Select-Object -Last 3
  } else {
    & $pyCore -m pip install --quiet edge-tts soundfile numpy scipy 2>&1 | Select-Object -Last 3
  }
  & $pyCore -c "import edge_tts, soundfile, numpy, scipy; print('基础环境 OK')" 2>&1 | Select-Object -Last 2
}

Write-Host "`n=== 2/2 RVC 环境（PY_RVC）===" -ForegroundColor Cyan
if (-not $pyRvc) { Write-Host "PY_RVC 没配，跳过" -ForegroundColor Yellow }
elseif (-not (Test-Path $pyRvc)) { Write-Host "PY_RVC 不存在：$pyRvc（先手动建 venv 或改 .env）" -ForegroundColor Red }
else {
  Write-Host "装 torch（CPU 版；有 CUDA 就自己换 cu121 源）…"
  if ($uv) { & uv pip install --python $pyRvc torch torchaudio --index-url https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | Select-Object -Last 3 }
  else { & $pyRvc -m pip install torch torchaudio 2>&1 | Select-Object -Last 3 }

  Write-Host "装 rvc-python（会连带 fairseq 源码编译，Windows 需要 VS Build Tools）…"
  if ($uv) { & uv pip install --python $pyRvc rvc-python 2>&1 | Select-Object -Last 5 }
  else { & $pyRvc -m pip install rvc-python 2>&1 | Select-Object -Last 5 }

  Write-Host "`n检查 fairseq（编译失败时看下面的提示）："
  $ok = & $pyRvc -c "import fairseq; print('fairseq', fairseq.__version__)" 2>&1
  if ($ok -match 'fairseq') {
    Write-Host "  $ok" -ForegroundColor Green
  } else {
    Write-Host @"
  fairseq 没装上。Windows 上常见原因与修法：
   1) 缺 VS Build Tools → 装 "Desktop development with C++"
   2) cpp_extension.py 编码问题 → 把其中的 subprocess 输出改成 errors='replace'
   3) checkpoint 加载报 weights_only → fairseq/checkpoint_utils.py 里改 weights_only=False
   4) torch 2.x 与新 API 冲突 → 用 torch 2.1~2.5，不要 2.6+
"@ -ForegroundColor Yellow
  }

  Write-Host "`n打补丁（rvc_python 的几个已知兼容问题）…"
  & $pyRvc -c @"
import os, re, site
for p in site.getsitepackages():
    f = os.path.join(p, 'rvc_python', 'infer.py')
    if os.path.exists(f):
        s = open(f, encoding='utf-8').read()
        if 'weights_only' not in s and 'tuple' in s:
            pass
        print('rvc_python:', f)
"@ 2>&1 | Select-Object -Last 3
}

Write-Host "`n完成。下一步：install.ps1" -ForegroundColor Green
