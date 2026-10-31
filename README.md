# dsh-qq-companion

给 [DeepSeek Harness](https://deepseek.com) 加一层「QQ 群友」人格：**会在群里聊天、会发语音、会点歌翻唱、会写日记和说说、会定时提醒人，还内置了一位情感军师**。

它不是聊天机器人框架，而是一套**人格 + 工具链**的实践仓库：把「让 AI 在群聊里像个真人」这件事，从提示词一直做到声音和唱歌。

```
QQ 群消息
   ↓  SnowLuma（QQ 网关，需自行获取）
   ↓  qq-bridge（消息桥接，MIT）
   ↓  DeepSeek Harness（Agent 运行时）
   ↓  ┌──────────────────────────────────────────┐
      │ 人格卡  roles/肥嘟嘟.md                     │
      │ 工具层  src/mcp-diary.js（语音/点歌/日记/提醒/军师）│
      │ 语音链  豆包 TTS → RVC 音色 → 收尾处理        │
      │ 翻唱链  洛雪下载 → demucs → RVC → 修复 → 混音   │
      └──────────────────────────────────────────┘
   ↓  回到 QQ 群
```

## 它现在能做什么

| 能力 | 说明 |
|---|---|
| **聊天** | 短句、多气泡、会潜水、会接梗；有明确的反 AI 味规则（不总结、不升华、不说"希望这个回答对你有帮助"） |
| **语音** | 豆包语音合成 2.0（带情感标签）→ RVC 换成指定音色 → 压缩/空气感/响度归一；撒娇、叫爸爸这类场合会自动用软语气 |
| **点歌翻唱** | 群里说「唱首晴天」→ 查本地存档；没有就自动下载、分离人声、换声、逐帧修复、混音、切段；**只发一段**，整首存档 |
| **日记 / 说说** | 白天随手记，每晚 23:30 生成正式日记并发一条 QQ 空间说说 |
| **提醒** | 「八点叫我」→ 到点在群里 @ 人；提醒是**分群**存的 |
| **情感军师** | 内置 [狗头军师](https://github.com/shengjidaguai-china/goutoujunshi) 框架（MIT，43 篇参考）：暗恋、暧昧、被冷落、分手、复合、「这句怎么回」都能接。群里裁剪成**结论前置 + 一个具体动作**，不念问卷、不做心理诊断；要话术就给可直接复制的成品 |
| **多群** | 每个群独立会话与记忆，工具调用带群号，不会串群 |

## 30 秒看懂它的人格

```
群友：你叫什么？
她：肥嘟嘟 / 蓝色大肥鱼，随便叫

群友：今天好累
她：那先歇会儿 / 想吐槽我就听 不想说也不用硬找话题

群友：你是真人吗
她：<OWNER_NAME> 设的 AI 呀 / 撒娇归撒娇 这个不糊弄你
```

完整人格卡在 [`roles/肥嘟嘟.md`](roles/肥嘟嘟.md)，约 6600 字，分 17 节：身份、说话铁律、AI 味黑名单、节奏、梗、情绪场景、群聊策略、日记、嗓子、表情包、断线处置、正反例、形象、点歌、多群、感情顾问、撒娇。

## 技术栈

| 层 | 组件 | 许可 |
|---|---|---|
| 消息网关 | SnowLuma（OneBot v11） | **闭源，需自行获取**，本仓库不打包 |
| 消息桥接 | [qq-bridge](https://github.com/)（v0.2.1-r1） | MIT |
| Agent 运行时 | DeepSeek Harness | 商业软件 |
| 语音合成 | 火山引擎 豆包语音合成 2.0（`seed-tts-2.0`） | 商业 API |
| 音色转换 | RVC（`rvc-python`）+ 自训音色模型 | 模型各有版权，不打包 |
| 人声分离 | demucs（`htdemucs`） | MIT |
| 音频修复 | 自研 `src/repair_audio.py` | MIT |
| 曲库下载 | 洛雪音乐（LX Music）+ CDP 自动化 | 客户端闭源，脚本 MIT |
| 感情顾问 | [狗头军师](https://github.com/shengjidaguai-china/goutoujunshi) | MIT（`vendor/goutoujunshi/`） |

## 快速开始

> 完整步骤见 [`docs/INSTALL.md`](docs/INSTALL.md)。这里只给顺序。

```powershell
# 0. 前置：装好 SnowLuma、qq-bridge、DeepSeek Harness、Python 3.10、ffmpeg
# 1. 配置
Copy-Item .env.example .env
notepad .env            # 填 <尖括号> 里的路径

# 2. 检查依赖
powershell -File install/check-prereqs.ps1

# 3. 装两个 Python 环境（RVC 环境要编译 fairseq，比较久）
powershell -File install/setup-python.ps1

# 4. 导入人格卡 + 注册 MCP 工具
powershell -File install/install.ps1

# 5. 注册计划任务（日记 23:30 / 提醒每分钟）
powershell -File install/register-tasks.ps1
```

## 目录结构

```
dsh-qq-companion/
├─ roles/肥嘟嘟.md            人格卡（部署时复制到 qq-bridge/roles/）
├─ src/
│  ├─ mcp-diary.js            MCP 工具：语音 / 点歌 / 日记 / 提醒 / 军师
│  ├─ rvc_server.py           RVC 常驻服务（多音色热切换）
│  ├─ repair_audio.py         逐帧修复：补掉字、去咔哒、静音门限、补缝、去齿音、限幅
│  ├─ rvc_infer.py            单次 RVC 推理（服务不可用时的兜底）
│  ├─ tts.py                  edge-tts（备用引擎）
│  ├─ lib/config.mjs          统一配置（环境变量 / .env）
│  └─ tools/
│     ├─ cover.mjs            翻唱主流程（分离→换声→修复→混音→切段→发群）
│     ├─ qq-cover.mjs         点歌入口（查存档 → 下载 → 翻唱）
│     ├─ lx-dom-download.mjs  用 CDP 操作洛雪下载（窗口最小化也能用）
│     ├─ volc-tts.mjs         豆包 TTS 命令行
│     ├─ split_song.mjs       按静音间隙切段
│     ├─ diary.mjs            日记 / 说说
│     └─ reminder-tick.mjs    提醒轮询
├─ vendor/goutoujunshi/       狗头军师 skill（MIT，保留原声明）
├─ config/                    配置模板（qq-bridge / DSH profile / 豆包凭据）
├─ install/                   安装脚本
├─ docs/                      架构、安装、运维、限制
└─ tests/smoke.mjs            自检：配置、端口、MCP、TTS、RVC
```

## 已知限制

- **SnowLuma 不能自动部署**：其 EULA 禁止把本体并入安装包或通过脚本启动，只能人工安装与启动。
- **RVC 音色模型受版权保护**（游戏角色语音等），本仓库不提供，需自备。
- **唱歌质量取决于音色模型的训练数据**：用语音语料训练的模型唱高音会破，这是 RVC 的固有问题，不是参数能完全解决的。
- **CPU 上很慢**：一首 4 分钟的歌约 20~25 分钟（分离 5 + 换声 15 + 修复 2）。
- 详细的技术边界见 [`docs/LIMITS.md`](docs/LIMITS.md)。

## 许可

本仓库代码 MIT。`vendor/goutoujunshi/` 是其上游作者的作品（MIT），保留原 LICENSE。第三方组件各自遵循其许可。

## 声明

这是一个**个人兴趣项目**，不是产品。人格卡里出现的「板板」是特定使用者与角色之间的关系设定，已脱敏处理；换个人用，把角色卡里的称呼改掉即可。
