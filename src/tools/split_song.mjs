#!/usr/bin/env node
/**
 * 把一首歌切成 ≤55 秒的语音片段，切点落在「句间静音」上，不切断句子。
 *
 * 做法：用 ffmpeg 的 silencedetect 分析**纯人声轨**（伴奏会把静音填满，不可靠），
 * 拿到静音区间后，在不超过上限的前提下尽量往后攒句子，攒到下一句会超就切。
 *
 * 用法：
 *   node split_song.mjs --vocal voc.wav --mix mix.mp3 [--max 55] [--send 1]
 */
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'voice-out')
const FFMPEG = 'C:\\Users\\jgao\\.dsh\\bili-duty\\.venv\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe'
const TOKEN = readFileSync('D:/QQ/qq-bridge/snowluma-token.txt', 'utf8').trim()

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const vocal = opt('vocal')
const mix = opt('mix')
const max = Number(opt('max', '55'))
const sendIdx = opt('send', '')
if (!vocal || !mix) {
  console.error('用法：--vocal <人声.wav> --mix <成品.mp3> [--max 55] [--send 1]')
  process.exit(1)
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    c.stderr.on('data', (b) => { err += b.toString('utf8') })
    c.on('error', reject)
    c.on('close', (code) => code === 0 ? resolve(err) : reject(new Error(err.slice(-300))))
  })
}

const ts = (s) => {
  const m = String(s).trim().replace(',', '.').split(':').map(Number)
  return m.length === 3 ? m[0] * 3600 + m[1] * 60 + m[2] : m[0] * 60 + m[1]
}

// 1) 找静音
const log = await run(FFMPEG, ['-hide_banner', '-i', vocal, '-af', 'silencedetect=noise=-38dB:d=0.30', '-f', 'null', '-'])
const starts = [...log.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]))
const ends = [...log.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]))
const durMatch = log.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/)
const total = durMatch ? ts(durMatch[1]) : 0

const gaps = []
for (let i = 0; i < starts.length; i++) {
  const s = starts[i]
  const e = ends[i] ?? s + 0.3
  if (e - s >= 0.25) gaps.push({ start: s, end: e, mid: (s + e) / 2 })
}
console.log(`总时长 ${total.toFixed(1)}s，检测到 ${gaps.length} 处静音间隙`)

// 2) 攒句子：每段尽量吃满上限，切点选「上限之前最后一个静音间隙」
const cuts = []
let segStart = 0
while (total - segStart > 1) {
  const limit = segStart + max
  let cut = null
  for (const g of gaps) {
    if (g.mid > limit) break
    if (g.mid - segStart < 8) continue
    cut = g.mid
  }
  if (cut === null) cut = Math.min(limit, total)
  if (cut - segStart < 3) break
  cuts.push({ start: segStart, end: cut })
  segStart = cut
}
// 尾巴太短就并进上一段（只要合起来不超上限）
if (cuts.length > 1) {
  const last = cuts[cuts.length - 1]
  const prev = cuts[cuts.length - 2]
  if (last.end - last.start < 8 && last.end - prev.start <= max) {
    prev.end = last.end
    cuts.pop()
  }
}

console.log(`切成 ${cuts.length} 段：`)
cuts.forEach((c, i) => console.log(`  #${i + 1}  ${c.start.toFixed(1)}s → ${c.end.toFixed(1)}s  (${(c.end - c.start).toFixed(1)}s)`))

// 3) 导出
const segDir = mix ? dirname(mix) : OUT
mkdirSync(segDir, { recursive: true })
const files = []
const baseName = (mix.split(/[\\/]/).pop() || 'song').replace(/\.[^.]+$/, '')
for (const [i, c] of cuts.entries()) {
  const out = join(OUT, `${baseName}-${i + 1}.mp3`)
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(c.start), '-to', String(c.end), '-i', mix, '-b:a', '128k', out])
  if (existsSync(out) && statSync(out).size > 5000) files.push(out)
}
console.log(`导出 ${files.length} 段`)

// 4) 可选：把某一段发成群语音
if (sendIdx) {
  const f = files[Number(sendIdx) - 1]
  if (!f) { console.error('没有这一段'); process.exit(1) }
  const r = await fetch('http://127.0.0.1:3000/send_group_msg', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ group_id: <GROUP_ID>, message: [{ type: 'record', data: { file: 'file:///' + f.replace(/\\/g, '/') } }] }),
    signal: AbortSignal.timeout(120000),
  })
  const j = await r.json()
  console.log('发送结果：', JSON.stringify(j).slice(0, 200))
}
