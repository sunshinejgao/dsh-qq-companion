# 运维手册

## 启动 / 停止

| 组件 | 启动 | 停止 |
|---|---|---|
| SnowLuma | 双击其 `launcher.bat`（**不要脚本化**） | 关窗口 / QQ 退出 |
| qq-bridge | `node start-bridge.mjs` | Ctrl+C |
| RVC 服务 | `python src/rvc_server.py` | 杀进程 |
| 洛雪音乐 | 正常双击（需要 CDP 时加 `--remote-debugging-port=9222`） | 关窗口 |

**推荐顺序**：DSH → qq-bridge → SnowLuma → RVC 服务。

## 健康检查（30 秒）

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3000,3001,3100,8127 } |
  Select-Object LocalPort | Sort-Object LocalPort

Invoke-RestMethod http://127.0.0.1:8127/health    # {"ok":true,"model":"naxida"}
```

| 端口 | 服务 | 挂了会怎样 |
|---|---|---|
| 3000 | SnowLuma HTTP | 发不出消息，报 `fetch failed` |
| 3001 | SnowLuma WebSocket | 收不到消息，日志刷 `连接断开 code=1006` |
| 3100 | qq-bridge 控制台 | 桥接没起来 |
| 8127 | RVC 服务 | 语音/翻唱失败（会退回子进程模式，慢 5 倍） |

## 日志位置

| 日志 | 路径 |
|---|---|
| 桥接 | `<QQ_BRIDGE_DIR>/state/bridge.log` |
| 日记/说说 | `<repo>/src/tools/diary-cron.log` |
| 翻唱任务 | `<repo>/src/tools/cover-runs.log` |
| 提醒 | `<repo>/src/tools/reminders.log` |
| SnowLuma | 其安装目录 `logs/` |

## 常见故障

### 「忽略未授权会话 group:xxx」

白名单里没有这个群，或者**加了但没重启桥接**。

```powershell
# 1. 确认配置里有
(Get-Content <QQ_BRIDGE_DIR>\config.json -Raw | ConvertFrom-Json).allow.groups
# 2. 重启桥接
```

### 「QQ 发送失败: fetch failed」

SnowLuma 掉了。看端口 3000/3001 还在不在；重启 SnowLuma 后桥接会自动重连。

### 改了人格卡她不照做

两个可能：

1. **改错了文件**：当前角色由 `state/current-role.json` 决定，不是所有 `roles/*.md`
2. **她的上下文里是旧版**：本项目已改成每次唤醒注入整张卡；如果你用的是原版桥接，需要让她调 `qq_get_prompt`

### 语音没声音 / 报错

```powershell
# 逐段验证
node src/tools/volc-tts.mjs --text "测试" --voice zh_female_tianmeixiaoyuan_uranus_bigtts --out t.mp3
Invoke-RestMethod http://127.0.0.1:8127/health
```

- TTS 挂了 → 检查 `volc-app.json` 和账号额度
- RVC 挂了 → 看 `voice-models/<model>/` 里有没有 `.pth`

### 翻唱一直卡在「去下载」

```powershell
# 1. 洛雪开了 CDP 吗
Invoke-RestMethod http://127.0.0.1:9222/json/list | Select-Object -First 1
# 2. 手动跑一次下载，看它卡在哪一步
node src/tools/lx-dom-download.mjs "歌名" --row 1 --wait 60
```

常见原因：洛雪窗口被关闭（CDP 连不上）、这首歌所有源都是 `Invalid URL`（换 `--row 2/3` 试）。

### 大图/截图看不到

`config.json` 里给 ffmpeg：

```jsonc
"socialV2": { "voice": { "ffmpegPath": "D:\\QQ\\bin\\ffmpeg.exe" } }
```

改完重启桥接。

### 日记写了但说说没发

看 `diary-cron.log`：

```text
今天已经写过日记了 → 会跳过整段（白天有随手记时）
```

本项目已修成「只跳过写入，不跳过发布」；如果你在用旧脚本，手动补发：

```powershell
node src/tools/diary.mjs --publish-only --day 2026-10-29
```

## 调参速查

### 说话（`src/mcp-diary.js` → `TONES`）

| 项 | 作用 | 建议 |
|---|---|---|
| `voice` | 豆包音色 id | 女声甜一点的：`zh_female_tianmeixiaoyuan_uranus_bigtts` |
| `speed` | 语速系数 | 0.9–1.05 |
| `emotion` | 情感标签 | `happy` / `sad`（其余会被忽略） |
| `rvcPitch` | RVC 半音偏移 | 0；音色偏男声时可 +2~+4 |

### 唱歌（`src/tools/cover.mjs`）

| 项 | 当前值 | 说明 |
|---|---|---|
| `f0` | `rmvpe` | 比 `harvest` 稳，破音少 |
| `protect` | `0.9` | 保护清辅音，防吞字 |
| `index_rate` | `0.45` | 检索强度；太高会毛刺，太低会不像 |
| `filter_radius` | `3` | 音高中值滤波，5–7 更平滑但会糊 |
| `pitch` | `0` | 音域不匹配时 ±2 |

### 修复（`src/repair_audio.py`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `--gate-ref` | 无 | 给参考人声就做静音门限（压前奏杂音） |
| `--fill-gaps` | 关 | 补 ≤80ms 卡字缝 |
| `--max-gap-ms` | `80` | 补缝上限；再长的是真停顿 |

## 备份

要备份的只有三样：

```text
<QQ_BRIDGE_DIR>/state/           # 会话、记忆、唤醒配置、收藏表情
<QQ_BRIDGE_DIR>/roles/           # 人格卡
<repo>/covers/                   # 翻唱成品
```

模型和音频中间文件不用备（可重下/可重跑）。

## 升级注意

- 升级 qq-bridge 前先备份 `config.json` 和 `state/`；`scripts/setup-dsh.mjs` 会重写 profile 的 MCP 区块
- 升级 DSH 后确认 MCP 工具还在：`node tests/smoke.mjs`
- `vendor/goutoujunshi` 用 `node scripts/sync-junshi.mjs` 从上游同步
