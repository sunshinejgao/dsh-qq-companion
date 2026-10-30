// 肥嘟嘟的日记本 MCP server（stdio）。
// 由 DSH 的 MCP 客户端 spawn（profile cordis.patch.yml 里的 mcp-diary 行）。
//
// 工具：
//   diary_write  写一条随手记（聊天里想记就记）
//   diary_read   看最近几天
//   diary_today  看今天的
//
// 和 tools/diary.mjs 共用同一个目录：tools/diary/YYYY-MM-DD.md
// 那个脚本每天 23:30 写「正式日记」，这里写的是白天的碎片（挂在 ## 随手记 下）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { C } from './lib/config.mjs'

const DIARY_DIR = 'D:/MyCode/Python/work/bilibili/tools/diary';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function fileFor(day) {
  return path.join(DIARY_DIR, `${day}.md`);
}

/** 别把敏感信息记进日记 */
const SENSITIVE = [
  /\b1[3-9]\d{9}\b/,
  /\b\d{17}[\dXx]\b/,
  /\b\d{16,19}\b/,
  /(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i,
];

function writeEntry({ text, mood }) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: '内容为空' };
  if (body.length > 600) return { ok: false, error: '太长了（上限 600 字）' };
  if (SENSITIVE.some((re) => re.test(body))) return { ok: false, error: '含敏感信息，拒绝记录' };

  fs.mkdirSync(DIARY_DIR, { recursive: true });
  const day = dayKey();
  const file = fileFor(day);
  const tag = mood ? `（${String(mood).slice(0, 8)}）` : '';
  const line = `- ${hhmm()}${tag}${body}\n`;

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# ${day} · 肥嘟嘟的日记\n\n## 随手记\n${line}`, 'utf8');
    return { ok: true, file, day, created: true };
  }
  const txt = fs.readFileSync(file, 'utf8');
  if (txt.includes('## 随手记')) {
    fs.appendFileSync(file, line, 'utf8');
  } else {
    fs.appendFileSync(file, `\n## 随手记\n${line}`, 'utf8');
  }
  return { ok: true, file, day };
}

function readDays(days) {
  if (!fs.existsSync(DIARY_DIR)) return [];
  return fs.readdirSync(DIARY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-days)
    .map((f) => ({ day: f.replace('.md', ''), text: fs.readFileSync(path.join(DIARY_DIR, f), 'utf8') }));
}

const server = new McpServer({ name: 'diary', version: '0.1.0' });

server.tool(
  'diary_write',
  '在今天的日记里写一条随手记。聊天中遇到想记住的事（开心、不开心、某个瞬间、对某人的印象）就写一句。写的是你自己的私密日记，不是给群里看的，所以别写成汇报，也别复述整段对话。',
  {
    text: z.string().min(1).max(600).describe('日记正文，第一人称，一两句就够'),
    mood: z.string().max(8).optional().describe('心情标签，如 开心 / 有点烦 / 平常'),
  },
  async ({ text, mood }) => {
    const r = writeEntry({ text, mood });
    if (!r.ok) return { content: [{ type: 'text', text: `没记成：${r.error}` }], isError: true };
    return { content: [{ type: 'text', text: `记下了（${r.day}）${r.created ? '，顺便建了今天的日记' : ''}` }] };
  },
);

server.tool(
  'diary_read',
  '看最近几天的日记。想知道自己前几天写过什么、或者想接着上次的情绪说，就翻一下。',
  { days: z.number().int().min(1).max(30).optional().describe('看最近几天，默认 3') },
  async ({ days }) => {
    const list = readDays(days ?? 3);
    if (!list.length) return { content: [{ type: 'text', text: '还没有日记。' }] };
    return { content: [{ type: 'text', text: list.map((x) => `===== ${x.day} =====\n${x.text}`).join('\n') }] };
  },
);

server.tool(
  'diary_today',
  '看今天的日记（含随手记和晚上写的那篇）。',
  {},
  async () => {
    const file = fileFor(dayKey());
    if (!fs.existsSync(file)) return { content: [{ type: 'text', text: '今天还没写。' }] };
    return { content: [{ type: 'text', text: fs.readFileSync(file, 'utf8') }] };
  },
);

// ── 提醒（和日记分开：别人说「记一下」「提醒我」是待办，不是日记）────────────
const REMINDERS = 'D:/MyCode/Python/work/bilibili/tools/reminders.json';

function loadReminders() {
  try {
    const v = JSON.parse(fs.readFileSync(REMINDERS, 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
  } catch { return [] }
}
function saveReminders(list) {
  fs.writeFileSync(REMINDERS, JSON.stringify(list, null, 1) + '\n', 'utf8');
}
const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

server.tool(
  'reminder_add',
  '给别人定一个提醒：到点会在群里 @ 他说。别人说「明天八点叫我」「提醒我别忘了」这种，用这个，**不要用 diary_write**。时间要给绝对的本地时间（Asia/Shanghai），比如 2026-10-27T08:00:00。',
  {
    text: z.string().min(1).max(300).describe('到点要说的内容，如「起床了」「该交作业了」'),
    at: z.string().min(10).describe('本地时间 ISO，如 2026-10-27T08:00:00'),
    target: z.string().max(20).optional().describe('要 @ 的 QQ 号（可选）'),
    group: z.string().optional().describe('到点在哪个群提醒；在当前群定的就填当前群号'),
  },
  async ({ text, at, target, group }) => {
    // .NET 风格 7 位小数 JS 不认，先截到毫秒
    const when = new Date(String(at).replace(/(\.\d{3})\d+/, '$1'));
    if (Number.isNaN(when.getTime())) return { content: [{ type: 'text', text: `时间看不懂：${at}` }], isError: true };
    if (when.getTime() < Date.now() - 60_000) return { content: [{ type: 'text', text: '这个时间已经过去了' }], isError: true };
    const list = loadReminders();
    const item = { id: `r${Date.now().toString(36)}`, at: when.toISOString(), text, target: target || '', done: false, createdAt: new Date().toISOString() };
    list.push(item);
    saveReminders(list);
    return { content: [{ type: 'text', text: `定好了：${fmt(item.at)} → ${text}（到点我会在群里说）` }] };
  },
);

server.tool(
  'reminder_list',
  '看还没到点的提醒。',
  {},
  async () => {
    const list = loadReminders().filter((x) => !x.done);
    if (!list.length) return { content: [{ type: 'text', text: '没有待提醒的事。' }] };
    return { content: [{ type: 'text', text: list.map((x) => `${x.id}  ${fmt(x.at)}  ${x.text}`).join('\n') }] };
  },
);

server.tool(
  'reminder_done',
  '把一条提醒标记为完成（不想让它到点了）。',
  { id: z.string().min(1) },
  async ({ id }) => {
    const list = loadReminders();
    const hit = list.find((x) => x.id === id);
    if (!hit) return { content: [{ type: 'text', text: '没找到这条提醒' }], isError: true };
    hit.done = true;
    saveReminders(list);
    return { content: [{ type: 'text', text: `已取消：${hit.text}` }] };
  },
);

// ── 嗓子：edge-tts 出干声 → RVC 换成沃雅妮莎 → OneBot record ───────────────
const PY = C.pythonCore;
const PY_CORE = PY;
const TTS_PY = new URL('./tts.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RVC_PY = C.pythonRvc;
const RVC_SCRIPT = new URL('./rvc_infer.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FFMPEG = C.ffmpeg;
const VOICE_OUT = C.outDir;
const TOKEN_FILE = C.tokenFile;
const GROUP = C.defaultGroup;

// 豆包语音合成 2.0：voice 是音色 id，speed 是语速系数，emotion 是情感标签
const VOLC_CRED = C.volcCred;
const VOLC_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const VOLC_RESOURCE = 'seed-tts-2.0';
// 说话用的 RVC 音色（唱歌仍走 cover.mjs 里的沃雅妮莎）
const VOICE_MODEL = C.voiceModel;
const TONES = {
  平常: { voice: 'zh_female_tianmeixiaoyuan_uranus_bigtts', speed: 0.98, emotion: '', rvcPitch: 0 },
  开心: { voice: 'zh_female_tianmeixiaoyuan_uranus_bigtts', speed: 1.04, emotion: 'happy', rvcPitch: 0 },
  得意: { voice: 'zh_female_tianmeixiaoyuan_uranus_bigtts', speed: 1.02, emotion: 'happy', rvcPitch: 0 },
  低落: { voice: 'zh_female_tianmeixiaoyuan_uranus_bigtts', speed: 0.9, emotion: 'sad', rvcPitch: 0 },
  软: { voice: 'zh_female_tianmeixiaoyuan_uranus_bigtts', speed: 0.93, emotion: '', rvcPitch: 0 },
};

/** 调豆包 TTS，把音频写进 outFile */
async function doubaoSpeak(text, tone, outFile) {
  const cred = JSON.parse(fs.readFileSync(VOLC_CRED, 'utf8').replace(/^\uFEFF/, ''));
  const req = {
    text,
    speaker: tone.voice,
    audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((tone.speed - 1) * 100) },
  };
  if (tone.emotion) req.emotion = tone.emotion;
  const r = await fetch(VOLC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Api-App-Id': cred.appid,
      'X-Api-Access-Key': cred.token,
      'X-Api-Resource-Id': VOLC_RESOURCE,
      'X-Api-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({ user: { uid: 'fdd-bot' }, req_params: req }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('豆包 TTS HTTP ' + r.status);
  const raw = await r.text();
  const chunks = [];
  for (const line of raw.split('\n').map((s) => s.trim()).filter(Boolean)) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.data) chunks.push(Buffer.from(j.data, 'base64'));
    if (j.code && j.code !== 0 && j.code !== 20000000) throw new Error('豆包 TTS ' + j.code + ': ' + (j.message || ''));
  }
  if (!chunks.length) throw new Error('豆包 TTS 没有返回音频');
  fs.writeFileSync(outFile, Buffer.concat(chunks));
}

let lastVoiceAt = 0;

/** 按标点拆句，并给每句配一套「韵律计划」：停顿、语速偏移、音高偏移。
 *  真人说话不是匀速的——句尾会拖、问句会扬、长句中间会喘。 */
function splitClauses(text) {
  const raw = String(text).replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const out = [];
  const re = /([^，。！？、；：…,.!?;:]+)([，。！？、；：…,.!?;:]*)/g;
  let m;
  while ((m = re.exec(raw))) {
    const body = (m[1] || '').trim();
    if (!body) continue;
    const p = m[2] || '';
    let gap = 150;
    if (/[。！？.!?]/.test(p)) gap = 300;
    else if (/…/.test(p)) gap = 380;
    else if (/[，,、]/.test(p)) gap = 170;
    else if (/[；：;:]/.test(p)) gap = 230;
    out.push({ text: body, punct: p, gap });
  }
  if (!out.length) out.push({ text: raw, punct: '', gap: 150 });

  const n = out.length;
  for (let i = 0; i < n; i++) {
    const c = out[i];
    const isLast = i === n - 1;
    const question = /[？?]/.test(c.punct);
    const exclaim = /[！!]/.test(c.punct);
    const short = c.text.length <= 4;

    // 语速：句尾放慢（拖音），短句反而快一点，再叠 ±2.5% 随机
    let rateShift = 0;
    if (isLast) rateShift -= 8;
    if (short) rateShift -= 3;
    if (exclaim) rateShift += 4;
    rateShift += (Math.random() * 2 - 1) * 2.5;

    // 音高：问句上扬、句尾略降、开头略高（情绪起手）
    let pitchShift = i === 0 ? 2 : 0;
    if (question) pitchShift += 12;
    else if (isLast) pitchShift -= 3;
    if (exclaim) pitchShift += 5;
    pitchShift += (Math.random() * 2 - 1) * 2;

    // 停顿：不只按照标点，还看句子长度和随机（90~1.3 倍）
    const lenFactor = Math.min(1.5, 0.7 + c.text.length / 18);
    c.gap = Math.round(c.gap * lenFactor * (0.85 + Math.random() * 0.45));
    c.rateShift = Math.round(rateShift);
    c.pitchShift = Math.round(pitchShift);
    c.slowTail = isLast;
  }
  return out;
}

/** 把「基准语速/音高」和这句的偏移合起来，转成 edge-tts 的字符串参数 */
function shiftRate(rate, delta) {
  const m = String(rate || '+0%').match(/([+-]?)(\d+)%/);
  const base = m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : 0;
  const v = Math.max(-40, Math.min(40, Math.round(base + delta)));
  return (v >= 0 ? '+' : '') + v + '%';
}
function shiftPitch(pitch, delta) {
  const m = String(pitch || '+0Hz').match(/([+-]?)(\d+)/);
  const base = m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : 0;
  const v = Math.max(-40, Math.min(60, Math.round(base + delta)));
  return (v >= 0 ? '+' : '') + v + 'Hz';
}

function runCmd(cmd, argv, timeoutMs = 60000, env = null) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    let err = '';
    const t = setTimeout(() => { try { c.kill() } catch {} ; reject(new Error('超时')); }, timeoutMs);
    c.stderr?.on('data', (b) => { err += b.toString('utf8'); });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
    c.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.slice(-200))); });
  });
}

server.tool(
  'voice_say',
  '用语音在群里说一句（不是文字气泡）。只在你被要求「发条语音」「说句话听听」，或者情绪真的很足时用；平时别用，语音很占注意力。一句话别超过 120 字（约 15 秒）。转换大概要 30 秒，别急。',
  {
    text: z.string().min(1).max(120).describe('要说的话，口语，别写成书面语'),
    tone: z.enum(['平常', '开心', '得意', '低落', '软']).optional().describe('语气，默认 平常'),
    group: z.string().optional().describe('目标群号；在哪个群说话就填哪个群的号'),
  },
  async ({ text, tone, group }) => {
    if (Date.now() - lastVoiceAt < 120_000) {
      return { content: [{ type: 'text', text: '刚发过语音，等两分钟再说（别刷屏）' }], isError: true };
    }
    const t = TONES[tone || '平常'] || TONES.平常;
    fs.mkdirSync(VOICE_OUT, { recursive: true });
    const stamp = Date.now();
    const ttsMp3 = path.join(VOICE_OUT, `${stamp}.mp3`);
    const ttsWav = path.join(VOICE_OUT, `${stamp}.tts.wav`);
    const rvcWav = path.join(VOICE_OUT, `${stamp}.rvc.wav`);
    const finalMp3 = path.join(VOICE_OUT, `${stamp}.final.mp3`);

    // ① 豆包语音合成 2.0（seed-tts-2.0）：句内起伏和情感由引擎负责，
    //    不再手工拆句拼静音——那套是为了弥补 edge-tts 太平，引擎好了就该删。
    await doubaoSpeak(text, t, ttsMp3);
    if (!fs.existsSync(ttsMp3) || fs.statSync(ttsMp3).size < 1000) {
      return { content: [{ type: 'text', text: '语音合成失败' }], isError: true };
    }

    // ③ 转 16k 单声道（RVC 的输入要求）
    await runCmd(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', ttsMp3, '-ar', '16000', '-ac', '1', ttsWav], 120000);

    // ③ RVC 换成沃雅妮莎的音色：优先打常驻服务（9 秒），连不上才自己起进程（30 秒）
    let rvcOk = false;
    try {
      const res2 = await fetch('http://127.0.0.1:8127/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ in: ttsWav, out: rvcWav, pitch: t.rvcPitch ?? 0, f0: 'rmvpe', protect: 0.85, filter_radius: 3, model: VOICE_MODEL }),
        signal: AbortSignal.timeout(300000),
      });
      const j2 = await res2.json().catch(() => ({}));
      rvcOk = !!j2.ok;
      if (!rvcOk) console.error('rvc server 返回失败：', JSON.stringify(j2).slice(0, 200));
    } catch {
      rvcOk = false;
    }
    if (!rvcOk) {
      await runCmd(
        RVC_PY,
        [RVC_SCRIPT, '-i', ttsWav, '-o', rvcWav, '--f0', 'harvest', '--pitch', String(t.rvcPitch ?? 0)],
        600000,
        { ...process.env, RVC_SKIP_DOWNLOAD: '1' },
      );
    }
    if (!fs.existsSync(rvcWav) || fs.statSync(rvcWav).size < 1000) {
      return { content: [{ type: 'text', text: 'RVC 没产出音频' }], isError: true };
    }

    // ④ 收尾：轻压缩 + 一点空气感 + 响度归一，让声音别那么「平」
    try {
      await runCmd(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', rvcWav,
        '-af', 'highpass=f=70,equalizer=f=3200:width_type=o:width=1.2:g=1.5,acompressor=threshold=-20dB:ratio=2:attack=8:release=140,loudnorm=I=-16:TP=-1.5:LRA=9',
        '-b:a', '128k', finalMp3,
      ], 180000);
    } catch { /* 收尾失败就用原始产物 */ }
    const sendFile = fs.existsSync(finalMp3) && fs.statSync(finalMp3).size > 1000 ? finalMp3 : rvcWav;

    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    const res = await fetch('http://127.0.0.1:3000/send_group_msg', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ group_id: Number(group) || GROUP, message: [{ type: 'record', data: { file: 'file:///' + sendFile.replace(/\\/g, '/') } }] }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await res.json().catch(() => ({}));
    if (j.status === 'failed' || j.retcode !== 0) {
      return { content: [{ type: 'text', text: `发送失败：${JSON.stringify(j).slice(0, 160)}` }], isError: true };
    }
    lastVoiceAt = Date.now();
    return { content: [{ type: 'text', text: `已发语音（${tone || '平常'}）。说完就完了，别在文字里复述。` }] };
  },
);

// ── 点歌翻唱：群里有人要听歌，就调它（后台跑，别阻塞对话）───────────────
const COVER_SCRIPT = new URL('./tools/qq-cover.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const COVER_ARCHIVE = C.archiveDir;
let coverRunning = null;   // { song, startedAt }

server.tool(
  'cover_song',
  '点歌：把一首歌翻唱成我的声音发到群里。群里有人说「唱首XX」「来首XX」时用。已经在「已翻唱」里有的会直接重发（十几秒）；没有的会去下载再翻唱（约 20 分钟）。一次只能跑一首，跑完自动发群，别在对话里催。',
  {
    song: z.string().min(1).max(40).describe('歌名，尽量只写歌名，不要带歌手'),
    force: z.boolean().optional().describe('已经唱过也要重做'),
    group: z.string().optional().describe('要发到哪个群；在当前群点歌就填当前群号'),
    full: z.boolean().optional().describe('只有对方明确要「完整版/整首」时才传 true，否则只发一段'),
  },
  async ({ song, force, group, full }) => {
    const alive = coverRunning && (() => { try { process.kill(coverRunning.pid, 0); return true } catch { return false } })();
    if (alive) {
      const mins = Math.round((coverRunning.startedAt ? (Date.now() - coverRunning.startedAt) / 60000 : 0));
      return { content: [{ type: 'text', text: `还在唱《${coverRunning.song}》（已经 ${mins} 分钟），等这首完了再说` }], isError: true };
    }
    // 先看已翻唱里有没有（新文件叫「歌名-翻唱.mp3」，老文件叫「歌名-沃雅妮莎.mp3」，两种都认）
    let cached = '';
    try {
      if (fs.existsSync(COVER_ARCHIVE)) {
        const files = fs.readdirSync(COVER_ARCHIVE).filter((f) => /\.(mp3|flac|m4a|wav)$/i.test(f) && !/-\d+\.mp3$/i.test(f));
        cached = files.find((f) => f.startsWith(song + '-')) || files.find((f) => f.includes(song)) || '';
      }
    } catch { /* ignore */ }

    const args = [`"${song}"`];
    if (force) args.push('--force');
    if (group) args.push('--group', String(group));
    if (full) args.push('--upload');
    const child = spawn(C.dshExe, [COVER_SCRIPT, ...args], {
      cwd: 'D:/MyCode/Python/work/bilibili',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    coverRunning = { song, startedAt: Date.now(), pid: child.pid };

    return {
      content: [{
        type: 'text',
        text: cached
          ? `《${song}》以前唱过，已经在重发到群里了（几十秒）。别再问进度。`
          : `开始唱《${song}》了：要去搜、下载、分离、换声，大概 20 分钟，好了会直接发群里。`,
      }],
    };
  },
);

// ── 感情军师：把本地 skill「狗头军师」的框架喂给群里的角色 ────────────────
const JUNSHI_DIR = C.junshiDir;

function listJunshiRefs() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, prefix ? `${prefix}/${name}` : name);
      else if (name.endsWith('.md')) out.push((prefix ? `${prefix}/` : '') + name.replace(/\.md$/, ''));
    }
  };
  try {
    walk(path.join(JUNSHI_DIR, 'references'), '');
  } catch { /* ignore */ }
  return out;
}

server.tool(
  'junshi',
  '感情问题顾问：有人问恋爱/暧昧/追求/吵架/分手/复合/「这句怎么回」时，先调它拿框架再回答。不带参数给总纲；带 ref 给某一篇专题（写关键词即可，比如「话术」「吵架」「拒绝」「分手」「截图」）。',
  {
    ref: z.string().max(40).optional().describe('专题关键词，可省略'),
  },
  async ({ ref }) => {
    const skillMd = path.join(JUNSHI_DIR, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      return { content: [{ type: 'text', text: '军师 skill 没装（找不到 SKILL.md）' }], isError: true };
    }
    if (!ref) {
      return { content: [{ type: 'text', text: fs.readFileSync(skillMd, 'utf8') }] };
    }
    const refs = listJunshiRefs();
    const key = String(ref).trim();
    const hit = refs.find((r) => r.includes(key)) || refs.find((r) => r.split('/').pop().includes(key));
    if (!hit) {
      return { content: [{ type: 'text', text: `没找到「${key}」这个专题。可选：\n${refs.slice(0, 40).join('\n')}` }] };
    }
    const full = path.join(JUNSHI_DIR, 'references', hit + '.md');
    if (!fs.existsSync(full)) return { content: [{ type: 'text', text: '那篇读不出来' }], isError: true };
    return { content: [{ type: 'text', text: fs.readFileSync(full, 'utf8') }] };
  },
);

await server.connect(new StdioServerTransport());
