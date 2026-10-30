#!/usr/bin/env node
/**
 * 用「操作系统级鼠标事件」在洛雪里点歌下载。
 *
 * 为什么不用 CDP 的 Input 事件：洛雪的右键菜单是独立弹出层，
 * CDP 既截不到图、点了也命中不了（DOM 里 rect 全是 8,8）。
 * OS 级点击是真实鼠标，菜单在哪就能点哪。
 *
 * 用法：node lx-os-download.mjs "晴天" [--row 1] [--wait 120]
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PS = join(HERE, 'os-click.ps1')
const BASE = 'http://127.0.0.1:9222'
const song = process.argv[2]
const opt = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d }
const rowIdx = Math.max(0, Number(opt('row', 1)) - 1)
const waitSec = Number(opt('wait', 120))
const SAVE_DIR = (() => {
  try {
    const cfg = JSON.parse(readFileSync('C:/Users/jgao/AppData/Roaming/lx-music-desktop/LxDatas/config_v2.json', 'utf8').replace(/^\uFEFF/, ''))
    return cfg?.setting?.['download.savePath'] || 'C:\\Users\\jgao\\Desktop\\音频'
  } catch { return 'C:\\Users\\jgao\\Desktop\\音频' }
})()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ps(args) {
  return new Promise((resolve, reject) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { windowsHide: true })
    let out = '', err = ''
    c.stdout.on('data', (b) => { out += b.toString('utf8') })
    c.stderr.on('data', (b) => { err += b.toString('utf8') })
    c.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err || out)))
  })
}

async function connectCdp() {
  const list = await (await fetch(`${BASE}/json/list`)).json()
  const pages = list.filter((t) => t.type === 'page')
  const page = pages.find((p) => !/^User api/i.test(p.title)) || pages[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
    }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  return { send, close: () => ws.close() }
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}

async function main() {
  if (!song) throw new Error('用法：node lx-os-download.mjs "歌名"')
  const cdp = await connectCdp()

  // ① 置前 + 取窗口位置
  const rectOut = await ps(['-X', '-1', '-Y', '-1', '-Foreground'])
  const m = rectOut.match(/RECT (\d+) (\d+) (\d+) (\d+)/)
  if (!m) throw new Error('取窗口位置失败：' + rectOut)
  const [winX, winY, winW] = [Number(m[1]), Number(m[2]), Number(m[3])]
  console.log(`窗口：${winX},${winY} ${winW}x${m[4]}`)

  // ② 搜索（走输入框，慢一点）
  const box = await evalJs(cdp, `(() => {
    const el = [...document.querySelectorAll('input')].find(i => /Search/i.test(i.placeholder || ''));
    if (!el) return null; el.focus(); el.select && el.select(); return true;
  })()`)
  if (!box) throw new Error('找不到搜索框')
  await cdp.send('Input.insertText', { text: song })
  await sleep(600)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })

  // ③ 等结果
  let row = null
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    row = await evalJs(cdp, `(() => {
      const r = [...document.querySelectorAll('.list-item')][${rowIdx}];
      if (!r || !(r.innerText || '').trim()) return null;
      const b = r.getBoundingClientRect();
      return { text: (r.innerText||'').replace(/\\n/g,' | ').slice(0,80), x: Math.round(b.left + 120), y: Math.round(b.top + b.height/2) };
    })()`)
    if (row) break
  }
  if (!row) throw new Error('没搜到结果')
  console.log('目标：', row.text)

  // ④ OS 右键 → 点「下载」（菜单第一项在光标下 26px，第二项 ~62px）
  const sx = winX + row.x, sy = winY + row.y
  await ps(['-X', String(sx), '-Y', String(sy), '-Right'])
  await sleep(1200)
  await ps(['-X', String(sx + 60), '-Y', String(sy + 51)])
  console.log('已点下载，等音质框…')
  await sleep(2500)

  // ⑤ 音质框：DOM 里能查到就按它给的位置点
  const q = await evalJs(cdp, `(() => {
    const els = [...document.querySelectorAll('div,button')].filter(e => /\\d+\\s*K\\s*-\\s*[\\d.]+\\s*M(i)?B/i.test(e.innerText || ''));
    if (!els.length) return null;
    const el = els[els.length - 1];
    const r = el.getBoundingClientRect();
    return { text: el.innerText.trim().slice(0, 40), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`)
  if (q) {
    console.log('音质：', q.text)
    await ps(['-X', String(winX + q.x), '-Y', String(winY + q.y)])
    await sleep(2000)
  } else {
    console.log('（没看到音质框，可能直接开始下载）')
  }

  // ⑥ 等文件
  const startMs = Date.now() - 2000
  for (let i = 0; i < waitSec / 4; i++) {
    await sleep(4000)
    if (!existsSync(SAVE_DIR)) continue
    for (const f of readdirSync(SAVE_DIR)) {
      if (!/\.(mp3|flac|m4a|wav)$/i.test(f)) continue
      const p = join(SAVE_DIR, f)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.size > 100_000 && st.mtimeMs >= startMs) {
        console.log(JSON.stringify({ ok: true, file: p, sizeMB: Math.round(st.size / 1024 / 1024) }))
        cdp.close()
        return
      }
    }
  }
  cdp.close()
  throw new Error('没等到新文件')
}

main().catch((e) => { console.error('出错：', e.message); process.exit(1) })
