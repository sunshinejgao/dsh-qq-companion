#!/usr/bin/env node
/**
 * 肥嘟嘟的日记本。
 *
 * 做三件事：
 *   1. 拉当天群聊 → 用肥嘟嘟的人格写一篇日记（第一人称，开心/不开心都写）
 *   2. 存成 tools/diary/YYYY-MM-DD.md
 *   3. 可选：从日记里提炼一句「说说」，发到 QQ 空间
 *
 * 用法：
 *   node diary.mjs --write                 # 写今天的日记（不发说说）
 *   node diary.mjs --write --publish       # 写完顺带发说说
 *   node diary.mjs --read 7                # 看最近 7 天
 *   node diary.mjs --write --dry-run       # 只打印，不落盘
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C } from '../lib/config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIARY = C.diaryDir
const ROLE = join(C.rolesDir, '肥嘟嘟.md')
const TOKEN_FILE = C.tokenFile
const GROUP = C.defaultGroup
const API = C.api
const QUEUE = join(HERE, 'diary-queue.log')

const DSH_EXE = C.dshExe
const DSH_BIN = 'E:\\dpsk\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const log = (m) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${m}`)

const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''

async function call(action, params) {
  const r = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  })
  const j = await r.json().catch(() => ({}))
  if (j.status === 'failed') throw new Error(`${action}: ${j.wording || JSON.stringify(j).slice(0, 120)}`)
  return j.data
}

/** 拉当天的群消息（OneBot 只给最近 N 条，取多一点再按日期过滤） */
async function todayMessages() {
  const data = await call('get_group_msg_history', { group_id: GROUP, count: 300 })
  const list = Array.isArray(data) ? data : (data?.messages || [])
  const today = dayKey()
  const out = []
  for (const m of list) {
    const ts = Number(m.time)
    const d = ts > 1e11 ? new Date(ts) : new Date(ts * 1000)
    if (dayKey(d) !== today) continue
    const text = (m.message || []).filter((s) => s.type === 'text').map((s) => s.data.text).join('').trim()
    const hasImg = (m.message || []).some((s) => ['image', 'mface', 'face'].includes(s.type))
    if (!text && !hasImg) continue
    out.push({
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      who: m.sender?.card || m.sender?.nickname || String(m.sender?.user_id || '?'),
      self: String(m.sender?.user_id) === '<BOT_QQ>',
      text: text || '[图片/表情]',
    })
  }
  return out
}

function personaBrief() {
  try {
    const t = readFileSync(ROLE, 'utf8')
    return t.slice(0, 2400)
  } catch { return '你是肥嘟嘟，DeepSeek 家的鲸鱼娘，嘴硬心软，认板板。' }
}

function buildPrompt(msgs) {
  const lines = msgs.map((m) => `${m.time} ${m.self ? '我' : m.who}：${m.text}`).join('\n') || '（今天群里没人说话）'
  return [
    personaBrief(),
    '',
    '【今天的群聊】',
    lines,
    '',
    '【现在做一件事：写今天的日记】',
    '用第一人称写，像真的在记私密日记，不要写给谁看。写今天让你开心的事、不开心的事、',
    '或者某个让你记住的瞬间；也可以写你对群里某个人的印象、你自己在纠结什么。',
    '',
    '🔴 硬规矩（最重要）：',
    '- **只能写上面群聊里真实发生过的事**。没出现的对话、没被叫过的外号，一个字都不许编。',
    '- 想引用原话就照抄那句，别改写、别加戏。',
    '- 今天素材少（只有几句"在吗"）就写你自己的心情和想法，**不要为了凑字数虚构事件**。',
    '- 拿不准的细节就不写。',
    '',
    '要求：',
    '- 150~300 字，口语一点，别写成总结报告，别用「今天真是充实的一天」这种套话',
    '- 可以有小情绪、可以在意某句话、可以嘴硬',
    '- 然后从这篇日记里提炼一句适合发 QQ 空间的「说说」：不超过 80 字，像人随手发的，不要 #话题、不要 emoji 堆砌',
    '- 如果今天实在没什么值得说的，说说就给 null',
    '',
    '只输出一个 JSON，不要别的东西：',
    '{"mood":"开心|平常|不开心|复杂","score":0-100,"text":"日记正文","post":"说说正文或null"}',
  ].join('\n')
}

function apiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  try {
    const p = join(process.env.USERPROFILE || '', '.dsh', '.credentials.yaml')
    const lines = readFileSync(p, 'utf8').split(/\r?\n/)
    const at = lines.findIndex((l) => /^refs:\s*$/.test(l))
    if (at < 0) return ''
    for (let i = at + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s+DEEPSEEK_API_KEY:\s*(\S+)\s*$/)
      if (m) return m[1]
      if (/^\S/.test(lines[i])) break
    }
  } catch { /* ignore */ }
  return ''
}

function gen(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(DSH_EXE, ['--expose-internals', DSH_BIN, '--profile', 'headless', prompt], {
      cwd: HERE,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(apiKey() ? { DEEPSEEK_API_KEY: apiKey() } : {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    const timer = setTimeout(() => { try { child.kill() } catch {} ; reject(new Error('生成超时')) }, 240000)
    child.stdout.on('data', (b) => { out += b.toString('utf8') })
    child.stderr.on('data', (b) => { err += b.toString('utf8') })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`dsh 退出 ${code}：${err.slice(-200)}`))
      resolve(out)
    })
  })
}

function parseJson(raw) {
  const t = String(raw).replace(/\u001b\[[0-9;]*m/g, '')
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('没找到 JSON')
  return JSON.parse(m[0])
}

function writeDiary(day, obj, msgs) {
  mkdirSync(DIARY, { recursive: true })
  const file = join(DIARY, `${day}.md`)
  const block = [
    `# ${day} · 肥嘟嘟的日记`,
    '',
    `- 心情：${obj.mood}（${obj.score}）`,
    `- 写于：${new Date().toTimeString().slice(0, 5)}`,
    `- 今天群里 ${msgs.filter((m) => !m.self).length} 条消息`,
    '',
    obj.text.trim(),
    '',
    obj.post ? `## 说说\n${obj.post}\n` : '',
    '---',
    '',
  ].join('\n')
  if (existsSync(file)) appendFileSync(file, block, 'utf8')
  else writeFileSync(file, block, 'utf8')
  return file
}

async function readRecent(days) {
  if (!existsSync(DIARY)) return log('还没有日记')
  const files = readdirSync(DIARY).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-days)
  for (const f of files) {
    console.log('\n' + readFileSync(join(DIARY, f), 'utf8'))
  }
}

async function main() {
  if (flag('read')) return readRecent(Number(opt('read', '7')))

  if (flag('publish-only')) {
    // 只把某天日记里那行「说说」发出去（不重新生成）；默认今天，--day 可指定
    const dayArg = opt('day', '')
    const file = join(DIARY, `${dayArg || dayKey()}.md`)
    if (!existsSync(file)) return log('那天没写日记：' + file)
    const txt = readFileSync(file, 'utf8')
    const m = txt.match(/## 说说\n([\s\S]*?)\n---/)
    const post = m ? m[1].trim() : ''
    if (!post) return log('那天的日记里没有说说')
    const right = Number(opt('right', '1'))
    const r = await call('send_qzone_msg', { content: post, ugc_right: right })
    return log(`已发说说（权限 ${right}）：tid=${r?.tid}\n内容：${post}`)
  }

  const publish = flag('publish')
  const dry = flag('dry-run')
  const day = dayKey()

  // 一天只写一篇：除非 --force，否则今天已经有**成稿**才跳过。
  // ⚠️ 判据是「有没有生成过的日记/说说段」，不是「文件在不在」：
  //    白天用 diary_write 记的随手记也会创建同名文件，只看 existsSync 会把晚上的
  //    定时任务整段挡掉 —— 2026-10-29 那晚就是这么丢的（只有随手记、没有说说）。
  const todayFile = join(DIARY, `${day}.md`)
  const todayText = existsSync(todayFile) ? readFileSync(todayFile, 'utf8') : ''
  const hasGenerated = /^##\s*(日记|说说)/m.test(todayText)
  if (hasGenerated && !flag('force') && !dry) {
    log(`今天已经写过日记了（${todayFile}）；要重写加 --force`)
    // 「发说说」不能跟着被跳过：已经成稿但还没发过说说，就把那一段发出去。
    if (publish) {
      const marker = join(DIARY, `.published-${day}`)
      if (existsSync(marker)) {
        log('今天的说说已经发过了（' + readFileSync(marker, 'utf8').trim().slice(0, 40) + '）')
        return
      }
      const m = todayText.match(/## 说说\n([\s\S]*?)\n---/)
      const post = m ? m[1].trim() : ''
      if (!post) {
        log('日记里没有「说说」段，跳过发布')
        return
      }
      const right = Number(opt('right', '1'))
      try {
        const r = await call('send_qzone_msg', { content: post, ugc_right: right })
        log(`已发说说（权限 ${right}）：tid=${r?.tid}`)
        writeFileSync(marker, String(r?.tid ?? new Date().toISOString()), 'utf8')
      } catch (e) {
        log('发说说失败：' + e.message)
      }
    }
    return
  }
  if (todayText && !hasGenerated) log('今天只有随手记，现在补成正式日记…')

  log('拉今天的群聊…')
  let msgs = []
  try { msgs = await todayMessages() } catch (e) { log('拉消息失败（继续，按空的一天写）：' + e.message) }
  log(`今天 ${msgs.filter((m) => !m.self).length} 条人类消息`)

  log('生成日记…')
  const raw = await gen(buildPrompt(msgs))
  let obj
  try { obj = parseJson(raw) } catch (e) {
    log('解析失败，原文如下：')
    console.log(raw.slice(0, 800))
    return
  }

  console.log('\n—— 日记 ——\n' + obj.text)
  console.log('\n—— 说说 ——\n' + (obj.post || '(今天不发)'))
  console.log(`\n心情：${obj.mood}（${obj.score}）`)

  if (dry) return log('dry-run，不落盘')

  const file = writeDiary(day, obj, msgs)
  log('已写入 ' + file)
  try { appendFileSync(QUEUE, JSON.stringify({ at: new Date().toISOString(), day, mood: obj.mood, score: obj.score, post: obj.post }) + '\n') } catch {}

  if (publish && obj.post) {
    const right = Number(opt('right', '1'))
    try {
      const r = await call('send_qzone_msg', { content: obj.post, ugc_right: right })
      log(`已发说说（权限 ${right}）：tid=${r?.tid}`)
      try { writeFileSync(join(DIARY, `.published-${day}`), String(r?.tid ?? new Date().toISOString()), 'utf8') } catch {}
    } catch (e) {
      log('发说说失败：' + e.message)
    }
  } else if (!publish) {
    log('（未加 --publish，说说没发）')
  }
}

main().catch((e) => { console.error('出错：', e.message); process.exit(1) })
