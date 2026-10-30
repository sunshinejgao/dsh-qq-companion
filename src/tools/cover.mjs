#!/usr/bin/env node
/**
 * 一键翻唱：给一个音频文件，跑完整条链路。
 *
 *   demucs 分离人声 → RVC 换成沃雅妮莎 → 逐帧修复 → 混音 + 响度归一
 *     → 切成 ≤55 秒的语音段 → 发群 → 完整版传群文件
 *
 * 用法：
 *   node cover.mjs "C:\...\某首歌.mp3" [--pitch 0] [--no-send] [--max 55]
 */
import { existsSync, mkdirSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
import { C, requireConfig } from '../lib/config.mjs'
requireConfig(['pythonRvc', 'pythonCore', 'ffmpeg', 'archiveDir', 'tokenFile'])
const OUT = C.outDir
const RVC_MODEL = C.coverModel
const ARCHIVE = C.archiveDir
const WORK = C.voiceWork
const PY_RVC = C.pythonRvc
const PY_CORE = C.pythonCore
const FFMPEG = C.ffmpeg

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const flag = (n) => args.includes('--' + n)
const input = (args.find((a) => !a.startsWith('--') && existsSync(a)) || '').replace(/^["']+|["']+$/g, '')
const pitch = Number(opt('pitch', '0'))
const GROUP_ID = Number(opt('group', String(C.defaultGroup)))
const maxSeg = Number(opt('max', '55'))

function run(cmd, argv, timeoutMs = 3600000) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const t = setTimeout(() => { try { c.kill() } catch {} ; reject(new Error('超时')) }, timeoutMs)
    c.stderr.on('data', (b) => { err += b.toString('utf8') })
    c.on('error', (e) => { clearTimeout(t); reject(e) })
    c.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.slice(-400))) })
  })
}

const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`)

/** 跑一个命令只看 stderr（volumedetect 把统计打在 stderr 上） */
function captureStderr(cmd, argv, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const c = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const t = setTimeout(() => { try { c.kill() } catch {} ; resolve(err) }, timeoutMs)
    c.stderr.on('data', (b) => { err += b.toString('utf8') })
    c.on('error', () => { clearTimeout(t); resolve('') })
    c.on('close', () => { clearTimeout(t); resolve(err) })
  })
}

async function main() {
  if (!input) { console.error('用法：node cover.mjs "音频文件" [--pitch 0] [--no-send]'); process.exit(1) }
  const song = basename(input, extname(input))
  mkdirSync(OUT, { recursive: true })
  mkdirSync(WORK, { recursive: true })

  // ① 人声分离
  const sepDir = join(WORK, `sep-${Date.now()}`)
  log(`分离人声：${basename(input)}`)
  await run(PY_RVC, ['-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', sepDir, '--mp3', input])
  const vocals = findFile(sepDir, 'vocals.mp3')
  const inst = findFile(sepDir, 'no_vocals.mp3')
  if (!vocals || !inst) throw new Error('分离产物缺失')

  // ② 转 16k 单声道
  const ttsWav = join(OUT, `cover-${song}-in.wav`)
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', vocals, '-ar', '16000', '-ac', '1', ttsWav])

  // ③ RVC（长任务，单次 fetch 容易断，改成最多 3 次重试；已有产物就跳过）
  const rvcWav = join(OUT, `cover-${song}-rvc.wav`)
  if (existsSync(rvcWav) && statSync(rvcWav).size > 1e6 && flag('resume')) {
    log('已有 RVC 产物，跳过转换')
  } else {
    log(`RVC 转换（pitch ${pitch}）…`)
    let ok = false
    let lastErr = ''
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await fetch(RVC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ in: ttsWav, out: rvcWav, pitch, f0: 'rmvpe', index_rate: 0.45, protect: 0.9, rms: 0.75, filter_radius: 3, model: RVC_MODEL }),
          signal: AbortSignal.timeout(2400000),
        })
        const j = await res.json()
        if (j.ok) { ok = true; log(`RVC 完成（${j.sec}s）`) }
        else lastErr = j.error || 'unknown'
      } catch (e) {
        lastErr = e.message
        // fetch 报错但文件已经写出来了（服务端其实完成了，只是响应没送达）——直接当成功
        if (existsSync(rvcWav) && statSync(rvcWav).size > 1e6) {
          ok = true
          log('RVC 请求报错，但产物已生成，直接继续')
          break
        }
        log(`RVC 第 ${attempt} 次失败：${lastErr.slice(0, 80)}，重试…`)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    if (!ok) {
      if (existsSync(rvcWav) && statSync(rvcWav).size > 1e6) log('RVC 报错但产物在，继续用现有文件')
      else throw new Error('RVC 三次都失败：' + lastErr)
    }
  }

  // ④ 逐帧修复
  const repaired = join(OUT, `cover-${song}-repaired.wav`)
  log('逐帧修复…')
  // 带上参考人声：先做静音门限（压掉前奏杂音），再补 80ms 以内的「卡字缝」
  const rep = await run(PY_RVC, [join(HERE, 'repair_audio.py'), '-i', rvcWav, '-o', repaired, '--gate-ref', ttsWav, '--fill-gaps'])
    .then(() => '')
    .catch((e) => e.message)
  if (rep) log('修复警告：' + rep)
  const useVocal = existsSync(repaired) ? repaired : rvcWav

  // ⑤ 混音 + 响度
  mkdirSync(ARCHIVE, { recursive: true })
  const mix = join(ARCHIVE, `${song}-翻唱.mp3`)
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', inst, '-i', useVocal,
    '-filter_complex',
    '[1:a]aresample=44100,highpass=f=75,equalizer=f=250:width_type=o:width=1.5:g=-2,treble=g=4.5:f=3000:w=0.6,alimiter=limit=0.95[v];[0:a]volume=0.75[i];[v][i]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11',
    '-b:a', '192k', mix,
  ])

  // ⑥ 切段
  log('切段…')
  const splitOut = await run(process.execPath, [join(HERE, 'split_song.mjs'), '--vocal', useVocal, '--mix', mix, '--max', String(maxSeg)])
    .then(() => '')
    .catch((e) => e.message)

  const parts = readdirSync(OUT)
    .filter((f) => f.startsWith(song) && /-\d+\.mp3$/.test(f) && !f.includes('-rvc'))
    .sort((a, b) => Number(a.match(/-(\d+)\.mp3$/)[1]) - Number(b.match(/-(\d+)\.mp3$/)[1]))
  log(`成品：${mix}（${Math.round(statSync(mix).size / 1024 / 1024)} MB），${parts.length} 段`)

  // ⑦ 发送：只发第一段，整首只存档不发
  if (!flag('no-send') && parts.length) {
    const token = readFileSync(C.tokenFile, 'utf8').trim()
    const api = (p) => `${C.api}/${p}`
    const best = parts[0]
    const idx = Number(best.match(/-(\d+)\.mp3$/)[1])
    log(`发送第 ${idx}/${parts.length} 段`)
    const body = { group_id: GROUP_ID, message: [{ type: 'record', data: { file: 'file:///' + join(OUT, best).replace(/\\/g, '/') } }] }
    const r = await fetch(api('send_group_msg'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    const j = await r.json().catch(() => ({}))
    log(`语音 -> ${j.status || '?'}`)

    if (flag('upload')) {
      const up = await fetch(api('upload_group_file'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ group_id: GROUP_ID, file: 'file:///' + mix.replace(/\\/g, '/'), name: `${song}-翻唱.mp3` }),
        signal: AbortSignal.timeout(300000),
      })
      log('完整版上传：' + JSON.stringify(await up.json().catch(() => ({}))).slice(0, 120))
    } else {
      log('整首只存档，不发群（要发完整版加 --upload）')
    }
  }

  console.log(JSON.stringify({ ok: true, song, mix, parts: parts.length }))
}

function findFile(dir, name) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    if (f.isDirectory()) { const r = findFile(p, name); if (r) return r }
    else if (f.name === name) return p
  }
  return null
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1) })
