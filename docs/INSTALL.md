# 安装

> 这份文档假设你是**在一台 Windows 机器上从零开始**。整套东西全部跑在本机，不需要公网服务器。

## 0. 前置条件

| 需要 | 说明 |
|---|---|
| **Windows 10/11** | 脚本是 PowerShell + 批处理，路径用反斜杠 |
| **Python 3.10** | RVC 依赖对 3.11+ 支持不好（fairseq 编译会挂）。建议用 `uv` 装 |
| **Node.js 20+** | qq-bridge 与本节所有 `.mjs` 脚本 |
| **ffmpeg** | 音频处理；建议单独放一个固定目录，不要依赖 venv 里的 |
| **约 15 GB 磁盘** | 模型（RVC 音色 50–100 MB/个，hubert 180 MB，rmvpe 172 MB）+ 音频中间文件 |
| **DeepSeek Harness** | Agent 运行时 |
| **qq-bridge** | 消息桥接（MIT，自行获取部署） |
| **SnowLuma** | QQ 网关（**闭源，必须官网自行获取；其 EULA 禁止自动化部署，本仓库不打包也不代为启动**） |
| **火山引擎语音账号** | 豆包语音合成 2.0 的 APP ID + Access Token |

## 1. 装好三个外部组件

### 1.1 SnowLuma

从官方渠道下载、解压到任意目录，**双击它的 `launcher.bat` 手动启动**，确认：

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3000,3001 }
```

出现 3000 / 3001 两个监听才算成功。

> ⚠️ 不要写脚本自动启动它。EULA 明确禁止，且违反后可能直接封号。

### 1.2 qq-bridge

```powershell
git clone <qq-bridge 仓库地址> D:\QQ\qq-bridge
cd D:\QQ\qq-bridge
npm install
node scripts/setup-dsh.mjs      # 把 MCP 配置写进 DSH profile
```

然后编辑 `qq-bridge/config.json`：

```jsonc
{
  "allow": { "private": [], "groups": [<GROUP_ID>] },
  "ownerQQ": <OWNER_QQ>,
  "socialV2": {
    "agentPreset": "qq-chat-v2",
    "voice": { "ffmpegPath": "<你的 ffmpeg.exe>" },
    "media": { "maxModelBytes": 1048576, "maxLongEdge": 1280, "gifFrames": 5, "gifTile": 2 }
  }
}
```

参考 `config/config.example.json`。

**加群之后必须重启桥接**（白名单只在启动时读一次）。

### 1.3 DeepSeek Harness

装好后确认 `DSH_EXE` 指向真实路径，例如 `E:\dpsk\DeepSeek Harness.exe`。

## 2. 配置本仓库

```powershell
cd D:\dsh-qq-companion
Copy-Item .env.example .env
notepad .env
```

至少填这五项：

```ini
QQ_BRIDGE_DIR=D:\QQ\qq-bridge
DSH_EXE=E:\dpsk\DeepSeek Harness.exe
PY_RVC=D:\QQ\voice-env\Scripts\python.exe
PY_CORE=C:\Users\<你>\.dsh\bili-duty\.venv\Scripts\python.exe
FFMPEG=D:\QQ\bin\ffmpeg.exe
```

## 3. 检查依赖

```powershell
powershell -ExecutionPolicy Bypass -File install/check-prereqs.ps1
```

它会逐项检查：Node、Python、ffmpeg、DSH、qq-bridge、端口、模型目录，缺什么直接说缺什么。

## 4. 建 Python 环境

```powershell
powershell -ExecutionPolicy Bypass -File install/setup-python.ps1
```

做两件事：

1. `PY_CORE` 环境：装 `edge-tts`、`soundfile`、`numpy`、`scipy`
2. `PY_RVC` 环境：装 `torch`（CPU 版即可）、`rvc-python`，并**编译 fairseq 0.12.2**（Windows 上需要 VS Build Tools，约 10–20 分钟）

> fairseq 在 Windows 上编译常见三个坑，`setup-python.ps1` 会自动打补丁：
> - `torch/utils/cpp_extension.py` 需要 `errors='replace'`
> - `fairseq/checkpoint_utils.py` 需要 `weights_only=False`
> - `rvc_python/infer.py` 对元组返回值的处理

## 5. 装 RVC 模型

把音色模型放到 `RVC_MODELS_DIR`（默认 `<repo>/voice-models`）：

```text
voice-models/
  ├─ naxida/          ← 说话+唱歌用的音色
  │   ├─ xxx.pth      （50–100 MB）
  │   └─ xxx.index    （可选，20–100 MB，检索增强）
  └─ other-voice/
      └─ ...
```

命名规则：目录名就是 `model` 参数的值。

> 模型文件受版权保护（游戏角色、真人声音等），**本仓库不提供**。自己训练或用社区分享的，注意只在私人场合使用。

## 6. 配豆包语音合成

在[火山引擎语音控制台](https://console.volcengine.com/speech/app)开通「豆包语音合成模型2.0」，拿到 **APP ID** 和 **Access Token**：

```powershell
@'
{"appid":"<APP_ID>","token":"<ACCESS_TOKEN>"}
'@ | Set-Content -Encoding UTF8 <QQ_BRIDGE_DIR>\volc-app.json
```

测一下：

```powershell
node src/tools/volc-tts.mjs --text "你好，我是测试" --voice zh_female_tianmeixiaoyuan_uranus_bigtts --out test.mp3
```

## 7. 安装人格卡与 MCP

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1
```

它做四件事：

1. 把 `roles/肥嘟嘟.md` 复制到 `<QQ_BRIDGE_DIR>/roles/`
2. 把 `state/current-role.json` 指向 `肥嘟嘟`
3. 在 DSH profile 里注册 `mcp-diary`（注意：必须放在 `# === qq-bridge MCP BEGIN/END ===` 区块**之外**，否则会被 `setup-dsh.mjs` 冲掉）
4. 把 `vendor/goutoujunshi` 链接到 `%USERPROFILE%\.dsh\skills\`（让 DSH 认到 skill）

## 8. 注册计划任务

```powershell
powershell -ExecutionPolicy Bypass -File install/register-tasks.ps1
```

| 任务 | 时间 | 干什么 |
|---|---|---|
| `dsh-qq-日记` | 每天 23:30 | 生成当天日记 + 发一条 QQ 空间说说 |
| `dsh-qq-提醒` | 每分钟 | 检查到点的提醒并 @ 人 |

## 9. 启动顺序（重要）

```text
1. qq-bridge + DSH（桥接会自己找 DSH 端口）
2. SnowLuma（手动双击 launcher.bat）
3. RVC 常驻服务（Startup 里放一个 run-rvc-server.cmd）
```

顺序反了不会挂，但会多等几个重连周期。

## 10. 自检

```powershell
node tests/smoke.mjs
```

逐项检查配置、端口、MCP 工具、TTS、RVC、存档目录。

## 排障

| 症状 | 先看哪里 |
|---|---|
| 群里没反应 | `<QQ_BRIDGE_DIR>/state/bridge.log` 有没有「忽略未授权会话」 |
| 改了人格没变化 | 确认改的是 `roles/<当前角色>.md`，且桥接注入了（每次唤醒都读） |
| 语音发不出来 | `PY_CORE` 能跑 `tts.py` 吗？`volc-app.json` 对不对？ |
| 翻唱卡在下载 | 洛雪开着吗？带 `--remote-debugging-port=9222` 启动了吗？ |
| 大图看不了 | `config.json` 的 `socialV2.voice.ffmpegPath` 填了吗？ |

更细的见 [`OPS.md`](OPS.md)。
