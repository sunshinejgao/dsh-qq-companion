#!/usr/bin/env node
/**
 * 提醒投递器：每分钟跑一次（Windows 计划任务「肥嘟嘟-提醒」）。
 * 读 tools/reminders.json，到点的就在群里发一条，然后把 done 置 true。
 *
 * 手动跑：node reminder-tick.mjs
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C } from '../lib/config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, 'reminders.json')
const LOG = join(HERE, 'reminders.log')
const TOKEN = readFileSync(C.tokenFile, 'utf8').trim()
const API = C.api
const DEFAULT_GROUP = C.defaultGroup

const log = (m) => {
  const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')}  ${m}`
  console.log(line)
  try { appendFileSync(LOG, line + '\n', 'utf8') } catch {}
}

const load = () => {
  try {
    const v = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    // PowerShell 的 ConvertTo-Json 会把单元素数组写成对象，这里统一成数组
    return Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
  } catch { return [] }
}
const save = (l) => writeFileSync(FILE, JSON.stringify(l, null, 1) + '\n', 'utf8')

async function send(text, target, group) {
  const message = target
    ? [{ type: 'at', data: { qq: String(target) } }, { type: 'text', data: { text: ' ' + text } }]
    : [{ type: 'text', data: { text } }]
  const r = await fetch(`${API}/send_group_msg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ group_id: Number(group) || DEFAULT_GROUP, message }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await r.json().catch(() => ({}))
  if (j.status === 'failed' || j.retcode !== 0) throw new Error(JSON.stringify(j).slice(0, 200))
  return j.data
}

const list = load()
if (!list.length) process.exit(0)

const now = Date.now()
// .NET 的时间戳有 7 位小数（100ns），JS 只认 3 位；先截断再用
const parseAt = (v) => Date.parse(String(v ?? '').replace(/(\.\d{3})\d+/, '$1'))
let changed = false
for (const item of list) {
  if (item.done) continue
  const at = parseAt(item.at)
  if (Number.isNaN(at) || at > now) continue
  // 过期超过 2 小时的直接作废，别把一堆旧提醒一次性轰出来
  if (now - at > 2 * 3600_000) {
    item.done = true
    item.skipped = 'too-late'
    changed = true
    log(`作废（过期太久）：${item.text}`)
    continue
  }
  try {
    await send(item.text, item.target, item.group)
    item.done = true
    item.firedAt = new Date().toISOString()
    changed = true
    log(`已提醒：${item.text}`)
  } catch (e) {
    log(`发送失败（下次再试）：${item.text} — ${e.message}`)
  }
}
if (changed) save(list)
