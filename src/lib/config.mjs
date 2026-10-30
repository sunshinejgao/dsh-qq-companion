/**
 * 统一配置：所有路径、群号、模型名都从这里取。
 *
 * 优先级：环境变量 > .env 文件 > 内置默认值。
 * 第一次部署时把 .env.example 复制成 .env，把里面 <尖括号> 的占位符改成本机真实路径。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB = dirname(fileURLToPath(import.meta.url))
export const SRC_DIR = dirname(LIB)
export const REPO_ROOT = dirname(SRC_DIR)

// 极简 .env 读取（不引第三方依赖）：KEY=VALUE，忽略 # 注释
function loadDotEnv() {
  const file = join(REPO_ROOT, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadDotEnv()

const env = process.env
const pick = (key, fallback) => {
  const v = env[key]
  return v === undefined || v === '' ? fallback : v
}

/** 桥接目录（qq-bridge 的部署位置） */
const bridgeDir = pick('QQ_BRIDGE_DIR', '')

export const C = {
  /** qq-bridge 部署目录（里面是 src/ roles/ state/ config.json） */
  bridgeDir,
  /** DSH 可执行文件 */
  dshExe: pick('DSH_EXE', ''),
  /** 跑 RVC 的 Python（装了 torch + rvc-python 的那个环境） */
  pythonRvc: pick('PY_RVC', ''),
  /** 跑 TTS/小工具的 Python */
  pythonCore: pick('PY_CORE', ''),
  /** ffmpeg 可执行文件 */
  ffmpeg: pick('FFMPEG', ''),

  /** 翻唱成品存档目录（建议做成指向仓库内 covers/ 的 junction） */
  archiveDir: pick('COVER_DIR', join(REPO_ROOT, 'covers')),
  /** 分离/换声的中间文件目录 */
  voiceWork: pick('VOICE_WORK', join(REPO_ROOT, 'work')),
  /** 分段、试音等临时产物 */
  outDir: pick('VOICE_OUT', join(REPO_ROOT, 'work', 'voice-out')),

  /** OneBot HTTP 接口 */
  api: pick('ONEBOT_API', 'http://127.0.0.1:3000'),
  /** SnowLuma 访问令牌文件 */
  tokenFile: pick('SNOWLUMA_TOKEN_FILE', bridgeDir ? join(bridgeDir, 'snowluma-token.txt') : ''),
  /** 默认群号（群聊里会显式传 group，这个只是兜底） */
  defaultGroup: Number(pick('DEFAULT_GROUP', '0')) || 0,

  /** 说话用的 RVC 音色目录名（在 voice-models/ 下） */
  voiceModel: pick('VOICE_MODEL', 'naxida'),
  /** 唱歌用的 RVC 音色 */
  coverModel: pick('COVER_MODEL', 'naxida'),
  /** RVC 模型根目录 */
  modelsRoot: pick('RVC_MODELS_DIR', join(REPO_ROOT, 'voice-models')),
  /** RVC 常驻服务端口 */
  rvcPort: Number(pick('RVC_PORT', '8127')) || 8127,

  /** 豆包 TTS 凭据文件 */
  volcCred: pick('VOLC_CRED', bridgeDir ? join(bridgeDir, 'volc-app.json') : ''),
  /** 人格卡目录 */
  rolesDir: pick('ROLES_DIR', bridgeDir ? join(bridgeDir, 'roles') : join(REPO_ROOT, 'roles')),
  /** 狗头军师 skill 目录 */
  junshiDir: pick('JUNSHI_DIR', join(REPO_ROOT, 'vendor', 'goutoujunshi')),
  /** 日记目录 */
  diaryDir: pick('DIARY_DIR', join(REPO_ROOT, 'data', 'diary')),
  /** 洛雪音乐（LX Music）CDP 调试端口 */
  lxCdp: Number(pick('LX_CDP_PORT', '9222')) || 9222,
  /** 洛雪下载落到哪个目录 */
  lxDownloadDir: pick('LX_DOWNLOAD_DIR', ''),
}

/** 缺关键配置时，给出可读的提示而不是让它后面莫名其妙地失败 */
export function requireConfig(keys) {
  const missing = keys.filter((k) => !C[k])
  if (missing.length) {
    throw new Error(
      `缺少配置：${missing.join(', ')}。把 .env.example 复制成 .env 并填好这些项（键名：` +
        missing.map((k) => k.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()).join(', ') +
        '）',
    )
  }
}
