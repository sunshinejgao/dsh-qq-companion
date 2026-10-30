#!/usr/bin/env node
/**
 * 豆包语音合成 2.0（火山引擎 seed-tts-2.0）命令行。
 *
 *   node volc-tts.mjs --text "你好" --voice zh_female_vv_uranus_bigtts --out a.mp3
 *   node volc-tts.mjs --text "你好" --voice ... --send        # 直接发到群里
 *
 * 依赖：openspeech v3 单向流式接口（SSE，返回 base64 音频块）。
 * 凭据存在 D:\QQ\qq-bridge\volc-app.json。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { C } from '../lib/config.mjs'

const CRED = C.volcCred
const URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
const RESOURCE = 'seed-tts-2.0'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const text = opt('text', '你好')
const voice = opt('voice', 'zh_female_vv_uranus_bigtts')
const out = opt('out', '')
const speed = Number(opt('speed', '1.0'))
const emotion = opt('emotion', '')
const send = args.includes('--send')
const group = opt('group', String(C.defaultGroup))

const cred = JSON.parse(readFileSync(CRED, 'utf8').replace(/^\uFEFF/, ''))

async function synth() {
  const reqParams = {
    text,
    speaker: voice,
    audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((speed - 1) * 100) },
  }
  if (emotion) reqParams.emotion = emotion
  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Api-App-Id': cred.appid,
      'X-Api-Access-Key': cred.token,
      'X-Api-Resource-Id': RESOURCE,
      'X-Api-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({ user: { uid: 'fdd-bot' }, req_params: reqParams }),
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const buf = []
  let err = ''
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let rest = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    rest += dec.decode(value, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() || ''
    for (const line of lines) {
      let t = line.trim()
      if (!t) continue
      if (t.startsWith('data:')) t = t.slice(5).trim()   // 兼容 SSE 包一层的情况
      if (!t || t === '[DONE]') continue
      let j
      try { j = JSON.parse(t) } catch { continue }
      if (j.data) buf.push(Buffer.from(j.data, 'base64'))
      if (j.code && j.code !== 0 && j.code !== 20000000) err = `${j.code}: ${j.message || ''}`
    }
  }
  if (!buf.length) throw new Error('没有收到音频数据 ' + err)
  return Buffer.concat(buf)
}

const audio = await synth()
const target = out || `D:/MyCode/Python/work/bilibili/tools/voice-out/volc-${Date.now()}.mp3`
writeFileSync(target, audio)
console.log(JSON.stringify({ ok: true, bytes: audio.length, file: target }))

if (send) {
  const token = readFileSync(C.tokenFile, 'utf8').trim()
  const r = await fetch('http://127.0.0.1:3000/send_group_msg', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ group_id: Number(group), message: [{ type: 'record', data: { file: 'file:///' + target.replace(/\\/g, '/') } }] }),
    signal: AbortSignal.timeout(120000),
  })
  console.log('发送：', JSON.stringify(await r.json()).slice(0, 120))
}
