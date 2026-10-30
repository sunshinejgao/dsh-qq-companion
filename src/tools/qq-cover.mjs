#!/usr/bin/env node
/**
 * 点歌 → 翻唱 → 发群（一条命令）。
 *
 *   node qq-cover.mjs "晴天" [--pitch 0] [--max-rows 5] [--no-send] [--force]
 *
 * 流程：
 *   1. 先查「已翻唱」文件夹：有就直接切段发群，不再下载/翻唱
 *   2. 没有 → 洛雪搜索下载（OS 级点击，逐行试到能下为止）
 *   3. 拿到文件 → cover.mjs：分离 → 换声 → 修复 → 混音 → 切段 → 发群
 *
 * --force 强制重做（即使已经翻唱过）。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, mkdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C } from '../lib/config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = C.archiveDir
const LOG = join(HERE, 'cover-runs.log')
const DSH = C.dshExe

const args = process.argv.slice(2)
const song = (args.find((a) => !a.startsWith('--')) || '').replace(/^["']+|["']+$/g, '')
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const maxRows = Number(opt('max-rows', '5'))
const pitch = opt('pitch', '0')
const GROUP_ID = Number(opt('group', String(C.defaultGroup)))
const noSend = args.includes('--no-send')
const force = args.includes('--force')

if (!song) {
  console.error('用法：node qq-cover.mjs "歌名"')
  process.exit(1)
}

const log = (m) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${m}`
  console.log(line)
  try { appendFileSync(LOG, line + '\n', 'utf8') } catch {}
}

function run(cmd, argv, timeoutMs = 3600000, env = null) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) })
    let out = '', err = ''
    const t = setTimeout(() => { try { c.kill() } catch {} ; reject(new Error('超时')) }, timeoutMs)
    c.stdout.on('data', (b) => { out += b.toString('utf8') })
    c.stderr.on('data', (b) => { err += b.toString('utf8') })
    c.on('error', (e) => { clearTimeout(t); reject(e) })
    c.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.slice(-400) || out.slice(-400))) })
  })
}

/** 在已翻唱目录里找同名成品 */
function findCovered(name) {
  if (!existsSync(ARCHIVE)) return null
  const files = readdirSync(ARCHIVE).filter((f) => /\.(mp3|flac|m4a|wav)$/i.test(f) && !/-\d+\.mp3$/i.test(f))
  const exact = files.find((f) => f.startsWith(name + '-'))
  if (exact) return join(ARCHIVE, exact)
  const loose = files.find((f) => f.includes(name))
  return loose ? join(ARCHIVE, loose) : null
}

const TOKEN = () => readFileSync(C.tokenFile, 'utf8').trim()

async function sendExisting(file) {
  log('已经翻唱过，直接重发：' + file)
  await run(process.execPath, [join(HERE, 'split_song.mjs'), '--vocal', file, '--mix', file, '--max', '55'], 600000)
  const dir = join(HERE, 'voice-out')
  const prefix = file.split(/[\\\\/]/).pop().replace(/\.(mp3|flac|m4a|wav)$/i, '')
  const segs = readdirSync(dir)
    .filter((f) => f.startsWith(prefix + '-') && /-\d+\.mp3$/.test(f))
    .sort((a, b) => Number(a.match(/-(\d+)\.mp3$/)[1]) - Number(b.match(/-(\d+)\.mp3$/)[1]))
  // 只发第一段
  if (segs.length) {
    const pick = segs[0]
    await fetch('http://127.0.0.1:3000/send_group_msg', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN() },
      body: JSON.stringify({ group_id: GROUP_ID, message: [{ type: 'record', data: { file: 'file:///' + join(dir, pick).replace(/\\/g, '/') } }] }),
      signal: AbortSignal.timeout(120000),
    }).catch(() => {})
  }
  if (args.includes('--upload')) {
    await fetch('http://127.0.0.1:3000/upload_group_file', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN() },
      body: JSON.stringify({ group_id: GROUP_ID, file: 'file:///' + file.replace(/\\/g, '/'), name: file.split('\\').pop() }),
      signal: AbortSignal.timeout(300000),
    }).catch(() => {})
  }
  log(`重发完成：1 段（共 ${segs.length} 段可选），整首在已翻唱里`)
}

async function main() {
  mkdirSync(ARCHIVE, { recursive: true })

  const cached = force ? null : findCovered(song)
  if (cached) {
    await sendExisting(cached)
    return
  }

  let file = null
  for (let row = 1; row <= maxRows && !file; row++) {
    log(`没翻唱过，去下载（试第 ${row} 行）…`)
    try {
      const out = await run(DSH, [join(HERE, 'lx-dom-download.mjs'), song, '--row', String(row), '--wait', '90'], 400000, { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
      const m = out.match(/\{[^{}]*"ok":true[^{}]*\}/)
      if (m) {
        const j = JSON.parse(m[0])
        file = j.file
        log(`拿到文件：${file}（${j.sizeMB} MB）`)
      }
    } catch (e) {
      log(`  第 ${row} 行失败：${(e.message || '').split('\n')[0].slice(0, 80)}`)
    }
  }
  if (!file) throw new Error(`${maxRows} 行都没下下来（可能都是 Invalid URL）`)
  if (!existsSync(file)) throw new Error('文件不见了：' + file)

  log('开始翻唱…')
  const out = await run(DSH, [join(HERE, 'cover.mjs'), file, '--pitch', String(pitch), ...(noSend ? ['--no-send'] : []), '--group', String(GROUP_ID), ...(args.includes('--upload') ? ['--upload'] : [])], 3600000, { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
  const tail = out.trim().split('\n').slice(-3).join(' | ')
  log('完成：' + tail)
}

main().catch((e) => { log('失败：' + e.message); process.exit(1) })
