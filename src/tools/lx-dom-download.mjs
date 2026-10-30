#!/usr/bin/env node
/**
 * 用 CDP 直接操作洛雪的 DOM 完成「搜索 → 右键 → 下载 → 音质确认」。
 *
 *   node lx-dom-download.mjs "大鱼" [--row 1] [--wait 90]
 *
 * 为什么不点 OS 鼠标：洛雪窗口最小化/被遮挡时，系统级点击落不到窗口上
 * （实测截图三张字节完全相同 = 窗口没重绘），但 CDP 的 DOM 事件依然有效。
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DOWNLOAD_DIR = 'C:\\Users\\jgao\\Desktop\\音频'
const CDP = 'http://127.0.0.1:9222'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const song = (args.find((a) => !a.startsWith('--')) || '').trim()
const row = Math.max(1, Number(opt('row', '1')))
const waitSec = Number(opt('wait', '90'))
if (!song) { console.error('用法：node lx-dom-download.mjs "歌名" [--row 1]'); process.exit(1) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json()
  const page = list.find((t) => t.type === 'page' && (t.url || '').startsWith('file:'))
  if (!page) throw new Error('洛雪没有可用的页面（它启动时带 --remote-debugging-port=9222 了吗？）')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  let id = 0
  const call = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    const on = (ev) => { const j = JSON.parse(ev.data); if (j.id === mid) { ws.removeEventListener('message', on); res(j.result) } }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || 'JS 执行失败')
    return r?.result?.value
  }
  return { ws, evaluate, call }
}

const snapshot = () => {
  try { return new Set(readdirSync(DOWNLOAD_DIR).filter((f) => /\.(mp3|flac|m4a|wav|ape)$/i.test(f))) } catch { return new Set() }
}

async function main() {
  const before = snapshot()
  const { ws, evaluate } = await connect()

  // ① 搜索
  const q = encodeURIComponent(song)
  await evaluate(`location.hash = '#/search?text=${q}&source=all&type=music'; true`)
  let rows = 0
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    rows = await evaluate(`document.querySelectorAll('.song-list .list-item, .list-item').length || 0`)
    if (rows >= row) break
  }
  if (!rows) throw new Error('搜索结果没出来')

  // ② 取第 row 行信息
  const info = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.song-list .list-item, .list-item')][${row - 1}];
    return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : '';
  })()`)
  if (!info) throw new Error(`第 ${row} 行不存在`)
  console.error(`目标：${info}`)

  // ③ 右键 → 点「下载」
  const opened = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.song-list .list-item, .list-item')][${row - 1}];
    if (!el) return 'no-row';
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + r.height / 2, button: 2 };
    el.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 2 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('contextmenu', opts));
    return 'ok';
  })()`)
  if (opened !== 'ok') throw new Error('右键失败')
  await sleep(400)

  const clicked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('li')].filter(e => (e.textContent || '').trim() === '下载');
    if (!items.length) return 'no-menu';
    items[items.length - 1].click();
    return 'clicked';
  })()`)
  if (clicked !== 'clicked') throw new Error('右键菜单里没有「下载」（可能这一行不支持下载）')

  // ④ 音质弹窗 → 点音质按钮（点它就开始下载）
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    const state = await evaluate(`(() => {
      const m = document.querySelector('.show-modal, [class*="show-modal"]');
      if (!m) return 'none';
      const btns = [...m.querySelectorAll('[class*="qYtUT"], button, .btn')];
      const quality = btns.filter(b => /音质|K\\s*-\\s*[\\d.]+\\s*M/i.test(b.textContent || ''));
      if (!quality.length) return 'waiting';
      // 有多档就挑文本里体积最大的那档（128K/320K/无损 依次更高）
      const pick = quality[quality.length - 1];
      pick.click();
      return 'confirmed: ' + (pick.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    })()`)
    if (state.startsWith('confirmed')) { console.error('音质：' + state.slice(11)); break }
    if (state === 'none' && i > 5) break
  }

  // ⑤ 等文件落地
  const startMs = Date.now() - 3000
  let found = null
  for (let i = 0; i < waitSec * 2; i++) {
    await sleep(500)
    let files = []
    try { files = readdirSync(DOWNLOAD_DIR).filter((f) => /\.(mp3|flac|m4a|wav|ape)$/i.test(f)) } catch { continue }
    const fresh = files.filter((f) => !before.has(f))
    const byTime = files
      .map((f) => ({ f, m: statSync(join(DOWNLOAD_DIR, f)).mtimeMs }))
      .filter((x) => x.m >= startMs)
    const hit = fresh[0] || (byTime.length ? byTime.sort((a, b) => b.m - a.m)[0].f : null)
    if (hit) {
      const full = join(DOWNLOAD_DIR, hit)
      const size = statSync(full).size
      if (size > 200 * 1024) { found = { file: full, sizeMB: +(size / 1024 / 1024).toFixed(2) }; break }
    }
  }
  ws.close()
  if (!found) throw new Error('没等到新文件（可能这个源下不动，换一行试试）')
  console.log(JSON.stringify({ ok: true, song, row, ...found }))
}

main().catch((e) => { console.error('出错：' + e.message); process.exit(1) })
