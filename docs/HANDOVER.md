# 交接文档（给接手的人 / AI Agent）

> 读者假设：你（Codex 或其他 agent）**没有参与过这个项目**，现在要接手维护。
> 这份文档按「你需要先知道什么」排序，不是按开发时间排序。
> 最后更新：2026-10-31

---

## 0. 30 秒摘要

**这是什么**：一个跑在本地 Windows 机器上的 QQ 群 AI 角色「肥嘟嘟」。她有固定人格、能发语音（豆包 TTS + RVC 换声）、能点歌翻唱、会写日记和 QQ 空间说说、能定提醒、能当情感顾问。

**代码在哪**：`https://github.com/sunshinejgao/dsh-qq-companion`（本仓库），本地 `D:\dsh-qq-companion`。

**跑在哪**：用户的一台 Windows 机器。所有组件都在本机，没有公网服务器。

**最关键的一句话**：这套系统真正难的不是"让 AI 说话"，而是**让它在群聊里像个真人，并且声音属于同一个角色**。所有设计取舍都围绕这一点。

---

## 1. 系统全貌

### 1.1 组件与端口

```
QQ 群
 ↓ 协议
SnowLuma            端口 3000(HTTP) / 3001(WS)    闭源，EULA 禁止自动部署
 ↓ OneBot v11
qq-bridge           端口 3100(控制台)              MIT，第三方
 ↓ DSH API
DeepSeek Harness    端口随机（启动日志里有）        商业软件
 ↓ MCP stdio
┌─────────────────────────────────────────────┐
│ roles/肥嘟嘟.md          人格卡（热注入）      │
│ src/mcp-diary.js         5 个工具             │
│ src/rvc_server.py        端口 8127            │
│ src/repair_audio.py      音频修复             │
│ src/tools/*.mjs          翻唱/下载/TTS/日记    │
└─────────────────────────────────────────────┘
 ↓ OneBot HTTP
回到 QQ 群
```

### 1.2 关键路径（这台机器上的真实位置）

| 东西 | 路径 |
|---|---|
| 本仓库 | `D:\dsh-qq-companion` |
| qq-bridge 部署 | `D:\QQ\qq-bridge` |
| 人格卡（生效的那份） | `D:\QQ\qq-bridge\roles\肥嘟嘟.md` |
| 当前角色指针 | `D:\QQ\qq-bridge\state\current-role.json` |
| 会话与唤醒状态 | `D:\QQ\qq-bridge\state\social-v2.json` |
| SnowLuma 令牌 | `D:\QQ\qq-bridge\snowluma-token.txt` |
| 豆包凭据 | `D:\QQ\qq-bridge\volc-app.json` |
| RVC 模型 | `D:\QQ\voice-models\{naxida,woyanisha08,luotianyi}` |
| 翻唱存档 | `C:\Users\jgao\Desktop\音频\已翻唱`（junction → `...\qq-bridge\tools\covers`） |
| 翻唱中间文件 | `D:\QQ\voice-work\sep-*` |
| DSH profile | `C:\Users\jgao\.dsh\profiles\desktop\cordis.patch.yml` |
| 军师 skill（DSH 认知的） | `C:\Users\jgao\.dsh\skills\goutoujunshi` |

### 1.3 身份（一律脱敏处理，不写进仓库）

- 主人（ownerQQ）：配置在 `qq-bridge/config.json` 的 `ownerQQ`
- 机器人 QQ：SnowLuma 里登录的那个小号
- 群：`allow.groups` 里那几个（目前 3 个）

**任何时候不要把这三个写进仓库、日志或提交信息。**

---

## 2. 这个项目是怎么长出来的（实验历程）

按时间顺序，每一段都写「想解决什么 → 试了什么 → 结论」。**这些结论比代码本身重要**，因为大部分坑已经踩过了。

### 阶段一：让她能说话（人格层）

- 起点是一个角色设定（鲸鱼娘、傲娇、嘴硬心软）
- 第一版人格卡的最大问题：**AI 味太重**——总结、升华、"希望这个回答对你有帮助"
- 解法：写一份「AI 味黑名单」，把禁止项逐条列出来（见人格卡第三节），并用正反例校准
- **关键教训**：光说"像真人"没用，要给出**可判定的禁用清单**和**长度上限**（默认 1~15 字）

### 阶段二：让她有记忆和声音

- 加 MCP 工具层（`mcp-diary.js`），把能力做成工具而不是靠提示词描述
- 语音第一版：edge-tts → 发群。问题：**朗读腔，句内音高是直线**
- 第二版：豆包语音合成 2.0（`seed-tts-2.0`）→ 有情感标签，句内有起伏
- 第三版：加 RVC 换声，把音色固定成角色音色
- **关键教训**：TTS 的"情感"不能靠调 rate/pitch 拼出来，必须换引擎；但换了之后要再过一遍 RVC，否则说话和唱歌不是同一个声音

### 阶段三：翻唱（最难的一段）

链路：洛雪下载 → demucs 分离 → RVC 换声 → 逐帧修复 → 混音 → 切段 → 发群

踩过的坑（按发现顺序）：

| 坑 | 现象 | 根因 | 解法 |
|---|---|---|---|
| 前奏沙沙声 | 前 30 秒有杂音 | RVC 在静音段生成噪声，分离残留被放大 | 按参考人声做**静音门限** |
| 门限太狠 | 主歌轻声字被切，听着断断续续 | 前奏残留（0.005~0.008）和轻声辅音（~0.01）电平重叠，单阈值必然二选一 | 改成「先划出全曲发声区间，区间内只掐长静音」 |
| 某些字"卡" | 「目的」「意义」「手里」吞字 | 换声模型在短音节掉帧 | `protect 0.9` + `rmvpe` + 补缝 |
| 洛雪点了没反应 | 5 个源全部"没等到新文件" | 窗口最小化 → 系统级鼠标点击落不到窗口 | 改用 **CDP DOM 事件**（`lx-dom-download.mjs`） |
| 下载成功但不落盘 | 右键点了"下载"却无文件 | 还有一层**音质弹窗**没点 | 点弹窗里文本含 `音质…K - …MB` 的按钮 |

### 阶段四：把系统交给别人也能跑

- 抽出 `src/lib/config.mjs`，所有路径走环境变量
- 写 4 个安装脚本 + 24 项自检（`tests/smoke.mjs`）
- 写四份文档（架构/安装/运维/边界）

---

## 3. 当前实现细节

### 3.1 人格层（`roles/肥嘟嘟.md`，6600 字，17 节）

注入机制：**qq-bridge 每次唤醒都读这个文件并整段注入提示词**。

- 所以改人格卡 = **保存即生效**，不用重启
- 上限 `role.maxInjectChars`（默认 8000 字符），超了会截断
- 之前有个 bug：原版桥接只在 `qq_get_prompt` 里给全文，导致改卡她不听。本仓库改成每次唤醒注入

关键小节：

| 节 | 内容 | 为什么重要 |
|---|---|---|
| 二 | 说话铁律（默认 1~15 字） | 长度是"像真人"的第一要素 |
| 三 | AI 味黑名单 | 可判定的禁用清单 |
| 八 | 日记 vs 提醒的区分 | 她曾把"提醒我八点"记成日记 |
| 十一 | 断线时不演苦情 | 她曾编造"被叫了三回大肥鱼" |
| 十六 | 情感军师裁剪规则 | 群里不能念问卷 |
| 十七 | 撒娇 | 要求「卸下傲娇」而不是换人格 |

### 3.2 工具层（`src/mcp-diary.js`）

5 个工具，全部走 stdio MCP：

| 工具 | 参数 | 行为 |
|---|---|---|
| `voice_say` | text, tone, group | 豆包 TTS → RVC → 收尾 → 发群；2 分钟限流 |
| `cover_song` | song, force, group, full | 查存档 → 命中则重发第 1 段；未命中走全流程 |
| `diary_write/read/today` | — | 日记读写 |
| `reminder_add/list/done` | text, at, target, group | 分群提醒 |
| `junshi` | ref | 返回军师总纲或某篇专题 |

**重要**：QQ 群会话的 agent preset（`qq-chat-v2`）**故意没有本地文件工具、没有 skill 插件**。所以：

- 她不能用 `skill` 工具加载 skill → 军师做成 MCP 工具而不是 skill
- 她不能读写文件 → 所有能力必须做成工具

### 3.3 语音链

```
文字
 → 豆包 seed-tts-2.0（voice=tianmeixiaoyuan / emotion=happy|sad / speed）
 → 16 kHz 单声道
 → RVC（model=naxida, f0=rmvpe, protect=0.85, filter_radius=3）
 → highpass 70 + 3.2k +1.5dB + 压缩 2:1 + loudnorm -16 LUFS
 → 发群
```

耗时约 15~20 秒（RVC 占大头）。

### 3.4 翻唱链

```
歌名
 → 查 covers/<歌名>-翻唱.mp3
   ├─ 有 → 切段 → 发第 1 段（约 10 秒）
   └─ 无 ↓
 → 洛雪 CDP 下载（逐行试不同的源）
 → demucs 分离
 → RVC（naxida, rmvpe, protect 0.9, index 0.45, filter 3）
 → repair_audio.py：掉帧补齐 → 去咔哒 → 静音门限 → 补 ≤80ms 缝 → 谱减 → 去齿音 → 限幅
 → 混伴奏 + loudnorm -14 LUFS
 → 存 covers/<歌名>-翻唱.mp3
 → 切 ≤55 秒
 → 只发第 1 段
```

耗时：4 分钟的歌约 20~25 分钟（CPU）。

### 3.5 情感军师

- 内置 `vendor/goutoujunshi`（MIT，上游 powerycy，43 篇参考）
- `junshi` 工具：无参数返回 `SKILL.md`；带 `ref` 模糊匹配某篇专题
- 角色卡第十六节规定群聊裁剪：不念问卷、结论前置、给可复制话术、不暴露工具、涉险转安全建议

---

## 4. 关键参数与被否决的方案

**这些结论是实测出来的，改之前先看这里。**

### 语音/翻唱参数

| 参数 | 当前值 | 备选 | 结论 |
|---|---|---|---|
| `f0` | `rmvpe` | `harvest` | rmvpe 更稳，破音少 |
| `protect` | 唱歌 0.9 / 说话 0.85 | 0.33（库默认） | 提高能显著减少吞字 |
| `index_rate` | 0.45 | 0 / 0.45 / 0.6 | 0 太不像，0.6 毛刺多 |
| `filter_radius` | 3 | 5~7 | 平滑但会糊，3 够用 |
| 音色 | `naxida` | `woyanisha08` | 实测纳西妲卡顿更少（虽然早期以为沃雅妮莎更好） |
| 门限阈值 | 自适应 `p10 + 0.18×(p60-p10)` | 固定比例 | 固定比例会把轻声段落整段切掉 |

### 被否决的方案（别再走一遍）

| 方案 | 为什么否决 |
|---|---|
| edge-tts 拆句+插静音拼"韵律" | 句内音高仍是直线，治不了"没感情"；换豆包后这套逻辑已删 |
| 门限用固定能量阈值 | 前奏残留与轻声辅音电平重叠，必然二选一 |
| 洛雪用系统级鼠标点击 | 窗口最小化时点击落不到窗口 |
| 洛雪用官方 openAPI 搜歌 | 2.12.6 的 `/search` 返回 401，没有 key |
| 用宿主 skill 机制给 QQ agent 加载军师 | 群聊 preset 没有 skill 插件，工具才可靠 |
| 用 GPT-SoVITS 换情感 | 需要 4GB 显存 + 训练，机器跑不动 |

---

## 5. 运维手册

### 5.1 启动顺序

```text
1. DeepSeek Harness（GUI 启动）
2. qq-bridge（node start-bridge.mjs，会自动探测 DSH 端口）
3. SnowLuma（手动双击 launcher.bat —— 不要脚本化，EULA 禁止）
4. RVC 常驻服务（python src/rvc_server.py，端口 8127）
5. 洛雪音乐（需要 CDP 时加 --remote-debugging-port=9222）
```

### 5.2 健康检查

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3000,3001,3100,8127 } |
  Select-Object LocalPort | Sort-Object LocalPort

Invoke-RestMethod http://127.0.0.1:8127/health
```

`{"ok":true,"model":"naxida"}` 才算 RVC 正常。

### 5.3 日志

| 日志 | 位置 |
|---|---|
| 桥接 | `D:\QQ\qq-bridge\state\bridge.log` |
| 翻唱 | `D:\dsh-qq-companion\src\tools\cover-runs.log`（本地运行时在 `tools/`） |
| 日记 | `diary-cron.log` |
| 提醒 | `reminders.log` |

### 5.4 三个必须记住的规则

1. **改 `config.json`（白名单/端口/ffmpeg 路径）必须重启桥接** —— 只在启动时读一次
2. **改人格卡不用重启** —— 每条消息重新读
3. **加群要改两处**：`allow.groups` + 重启

---

## 6. 已知问题（按优先级）

### P0 - 会影响用户

| 问题 | 现状 | 建议 |
|---|---|---|
| 唱歌部分字仍会"卡" | 已排除是门限问题（实测该段 0 缺口）；怀疑是换声模型的咬字问题 | 需要用户给出**具体时间点**才能定位 |
| 洛雪自动化脆弱 | DOM 选择器硬编码（`class="h0ywb"`），客户端升级就废 | 若失效，重新抓 DOM 结构 |
| 翻唱任务无断点续跑 | 中途失败要从分离重来 | 可加阶段性产物检测 |

### P1 - 影响维护

| 问题 | 说明 |
|---|---|
| 说话和唱歌音色需手动保持一致 | 两处配置（`VOICE_MODEL` / `COVER_MODEL`），换音色要两边改 |
| 旧翻唱作品是旧音色 | `covers/` 里早期作品是沃雅妮莎，新的是纳西妲 |
| 日记文件"随手记"和"正式日记"共用一个文件 | 判断靠正则找 `## 说说`，脆弱（已修过一次 bug） |

### P2 - 洁癖

- `repair_audio.py` 的阈值多是经验值，没有数据支撑
- `lx-dom-download.mjs` 没有单元测试

---

## 7. 边界（不可动的东西）

### 绝对不能做

| 事项 | 原因 |
|---|---|
| 打包 SnowLuma 或脚本化启动它 | 其 EULA 明确禁止，可能连带封号 |
| 把 RVC 模型（`.pth`/`.index`）提交到仓库 | 声音权利属原作版权方 |
| 商用、冒充真人、二次分发模型 | 同上 |
| 把 QQ 号 / 群号 / token / 密钥写进仓库或日志 | 隐私 |

### 音色模型来源（需保留此声明）

B 站 UP 主 **闪电蘑菇**，视频 [BV16gYS6sE5h](https://www.bilibili.com/video/BV16gYS6sE5h)。
README 与 `docs/LIMITS.md` 已标注，**不要删**。

---

## 8. 接手第一件事（checklist）

```text
□ 跑 node tests/smoke.mjs，确认 24 项里哪些红
□ 看 bridge.log 尾部，确认三个群都在调度
□ 在群里说「发条语音听听」，确认语音链路通
□ 在群里说「唱首晴天」，确认点歌走缓存路径（约 30 秒出）
□ 读 roles/肥嘟嘟.md 全文（6600 字，值得读）
□ 读 docs/LIMITS.md，知道哪些做不到
```

---

## 9. 环境坑（Windows 专属，都踩过）

| 坑 | 现象 | 规避 |
|---|---|---|
| PowerShell 反引号 | 双引号里的 `` ` `` 是转义符 | 含模板字符串的替换用单引号 |
| `Set-Content -Encoding UTF8` | 写出的 JSON 带 BOM，解析失败 | 用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` |
| 批处理中文 | cmd 用 OEM 代码页，中文乱码 | `.cmd` 文件**只能纯 ASCII** |
| Here-string | `@'` 后面必须立刻换行 | 或者干脆用 `edit` 工具而不是 PowerShell 拼串 |
| 沙箱写桌面 | 子进程写不了工作区外的目录 | 用 **junction** 把桌面目录指向仓库内 |
| `Start-Process` 带空格路径 | 参数被拆成多个 | 传 `'"C:\...\x.mp3"'`（引号包住），脚本里再 strip |
| DSH MCP 热重载 | 改了 `mcp-diary.js` 不生效 | 改 profile 里某个配置值（如 timeout）触发重载，或重启 DSH |
| Electron 当 node 用 | GUI 启动会开窗口 | 设 `ELECTRON_RUN_AS_NODE=1` |

---

## 10. 命令速查

```powershell
# 自检
node tests/smoke.mjs

# 单测语音合成
node src/tools/volc-tts.mjs --text "测试" --voice zh_female_tianmeixiaoyuan_uranus_bigtts --out t.mp3

# 单测 RVC
curl -X POST http://127.0.0.1:8127/convert -H "content-type: application/json" `
  -d '{"in":"a.wav","out":"b.wav","model":"naxida","f0":"rmvpe","protect":0.9}'

# 单测翻唱（不发群）
node src/tools/cover.mjs "某首歌.mp3" --no-send

# 只重发已翻唱的歌
node src/tools/qq-cover.mjs "晴天"

# 手动补发某天的说说
node src/tools/diary.mjs --publish-only --day 2026-10-29

# 洛雪下载排障
node src/tools/lx-dom-download.mjs "歌名" --row 1 --wait 60
```

---

## 11. 给接手者的三条建议

1. **先读人格卡再改代码**。很多"她表现不对"的问题根源在卡里，不在代码里。
2. **改任何音频参数前先做 A/B**。这个项目里有两处"我以为 A 更好，实测 B 更好"（f0、音色）。
3. **别信没有对齐的测量**。这个项目出过一次测量事故：对比参考人声和输出时没重采样，时间轴错位，得出"7 个方案都有卡顿"的错误结论。**测之前先确认采样率、帧对齐、时间基准一致。**
