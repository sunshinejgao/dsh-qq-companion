#!/usr/bin/env node
/**
 * 自检：一条命令看整套东西通不通。
 *
 *   node tests/smoke.mjs
 *
 * 检查顺序：配置 → 文件 → 端口 → RVC → 豆包 TTS → 存档目录 → 军师 skill
 * 任何一项失败都会打印「该怎么修」，而不是只抛个异常。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

let pass = 0
let fail = 0
const ok = (m) => { console.log(`  \x1b[32m[OK]\x1b[0m   ${m}`); pass++ }
const warn = (m) => { console.log(`  \x1b[33m[warn]\x1b[0m ${m}`); }
const bad = (m, fix) => { console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`); if (fix) console.log(`         → ${fix}`); fail++ }
const head = (m) => console.log(`\n\x1b[36m${m}\x1b[0m`)

// 读 .env（不依赖 config.mjs，先做一次裸检查）
function loadEnv() {
  const f = join(REPO, '.env')
  if (!existsSync(f)) return {}
  const out = {}
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

head('一、配置')
const env = loadEnv()
if (!existsSync(join(REPO, '.env'))) {
  bad('.env 不存在', '复制 .env.example 为 .env 并填好路径')
} else ok('.env 存在')

for (const [key, need] of [['QQ_BRIDGE_DIR', true], ['DSH_EXE', true], ['PY_RVC', true], ['PY_CORE', true], ['FFMPEG', true]]) {
  const v = env[key] || process.env[key]
  if (!v) { need ? bad(`${key} 没配`) : warn(`${key} 没配`); continue }
  if (v.startsWith('<')) bad(`${key} 还是占位符`)
  else if (!existsSync(v)) bad(`${key} 指向的路径不存在：${v}`)
  else ok(`${key} = ${v}`)
}

head('二、核心文件')
for (const rel of ['src/mcp-diary.js', 'src/rvc_server.py', 'src/repair_audio.py', 'src/tools/cover.mjs', 'src/tools/qq-cover.mjs', 'roles/肥嘟嘟.md']) {
  const p = join(REPO, rel)
  existsSync(p) ? ok(rel) : bad(`${rel} 缺失`, '是不是把仓库复制漏了？')
}

head('三、端口')
const ports = { 3000: 'SnowLuma HTTP', 3001: 'SnowLuma WS', 3100: 'qq-bridge' }
const { execSync } = await import('node:child_process')
let listen = ''
try { listen = execSync('netstat -ano -p tcp', { encoding: 'utf8' }) } catch {}
for (const [p, name] of Object.entries(ports)) {
  new RegExp(`:${p}\\s`).test(listen) ? ok(`${p} ${name}`) : warn(`${p} ${name} 没在监听`)
}

head('四、RVC 服务')
const rvcPort = Number(env.RVC_PORT || process.env.RVC_PORT || 8127)
try {
  const r = await fetch(`http://127.0.0.1:${rvcPort}/health`, { signal: AbortSignal.timeout(3000) })
  const j = await r.json()
  j.ok ? ok(`RVC 在线，音色 ${j.model}`) : warn('RVC 在线但没加载模型')
} catch {
  warn(`RVC 服务没起来（${rvcPort}）——语音和翻唱会退回子进程模式，慢很多`)
}

head('五、音色模型')
const modelsDir = env.RVC_MODELS_DIR || process.env.RVC_MODELS_DIR || join(REPO, 'voice-models')
if (!existsSync(modelsDir)) warn(`没有 ${modelsDir}`)
else {
  const dirs = readdirSync(modelsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
  if (!dirs.length) warn('voice-models 里没有音色目录')
  for (const d of dirs) {
    const files = readdirSync(join(modelsDir, d.name))
    const pth = files.find((f) => f.endsWith('.pth'))
    pth ? ok(`${d.name}（有 .pth）`) : warn(`${d.name} 里没有 .pth`)
  }
}

head('六、豆包 TTS 凭据')
const cred = env.VOLC_CRED || (env.QQ_BRIDGE_DIR ? join(env.QQ_BRIDGE_DIR, 'volc-app.json') : '')
if (cred && existsSync(cred)) {
  try {
    const j = JSON.parse(readFileSync(cred, 'utf8'))
    j.appid && j.token ? ok('凭据格式正确') : bad('凭据缺 appid 或 token')
  } catch { bad('凭据不是合法 JSON') }
} else bad('没有 volc-app.json', '语音合成会失败')

head('七、存档目录')
const archive = env.COVER_DIR || join(REPO, 'covers')
existsSync(archive) ? ok(`存档目录：${archive}`) : warn(`存档目录不存在（首次翻唱会自动建）`)

head('八、军师 skill')
const junshi = env.JUNSHI_DIR || join(REPO, 'vendor', 'goutoujunshi')
existsSync(join(junshi, 'SKILL.md')) ? ok('军师 skill 就位') : bad('军师 skill 缺失', 'git submodule 或重新复制 vendor/goutoujunshi')
const refs = join(junshi, 'references')
if (existsSync(refs)) {
  const n = readdirSync(refs, { recursive: true }).filter((f) => String(f).endsWith('.md')).length
  ok(`参考文档 ${n} 篇`)
}

head('九、洛雪 CDP')
const lxPort = Number(env.LX_CDP_PORT || process.env.LX_CDP_PORT || 9222)
try {
  const r = await fetch(`http://127.0.0.1:${lxPort}/json/list`, { signal: AbortSignal.timeout(3000) })
  const pages = await r.json()
  ok(`洛雪 CDP 可用（${pages.length} 个页面）`)
} catch {
  warn(`洛雪 CDP 连不上（${lxPort}）——点歌下载会失败；启动时加 --remote-debugging-port=${lxPort}`)
}

console.log('')
if (fail === 0) console.log(`\x1b[32m全部通过（${pass} 项）。\x1b[0m`)
else { console.log(`\x1b[31m${fail} 项失败，${pass} 项通过。\x1b[0m`); process.exit(1) }
