# 更新日志

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`主版本.次版本.修订号`。

## [0.1.0] - 2026-10-31

首个可部署版本。

### 新增

**人格层**

- `roles/肥嘟嘟.md`：17 节人格卡（约 6600 字），覆盖身份、说话铁律、AI 味黑名单、消息节奏、梗、情绪场景、群聊策略、日记、嗓子、表情包、断线处置、正反例、形象、点歌、多群、情感军师、撒娇
- 反 AI 味硬规则：不总结、不升华、不用括号写动作、不写 Markdown 列表、不用客服腔
- 「当我说不出去的时候」小节：断线时不演苦情、不刷屏、不质问

**MCP 工具层**（`src/mcp-diary.js`）

- `voice_say`：文字转语音发群，五种语气，`group` 参数支持多群
- `cover_song`：点歌翻唱，先查本地存档，未命中则走下载→换声全流程；`full` 参数可发完整版
- `diary_write` / `diary_read` / `diary_today`：随手记与日记读取
- `reminder_add` / `reminder_list` / `reminder_done`：分群提醒
- `junshi`：情感军师，不带参数返回总纲，带 `ref` 返回专题

**语音链路**

- 豆包语音合成 2.0（`seed-tts-2.0`）接入，支持 `emotion` 情感标签与语速系数
- RVC 换声，常驻服务 `src/rvc_server.py`，支持多音色热切换（`model` 参数）
- 收尾处理：高通、3.2kHz 抬升、轻压缩、响度归一

**翻唱链路**

- `src/tools/cover.mjs`：demucs 分离 → RVC → 逐帧修复 → 混音 → 切段 → 发群
- `src/tools/lx-dom-download.mjs`：用 CDP 操作洛雪音乐搜索与下载（**窗口最小化也能用**，不依赖系统级鼠标点击）
- `src/tools/split_song.mjs`：按静音间隙切 ≤55 秒
- 整首存档到 `covers/`，**只发第一段**，避免刷屏

**音频修复**（`src/repair_audio.py`）

- 掉帧补齐、去咔哒
- 按参考人声做静音门限（压掉前奏的分离残留）
- 补 ≤80ms「卡字缝」（前后波形交叉淡化）
- 频谱减淡、去齿音、软限幅

**情感军师**

- 内置 [goutoujunshi](https://github.com/shengjidaguai-china/goutoujunshi)（MIT，上游 powerycy），43 篇参考文档
- `src/tools/../mcp-diary.js` 的 `junshi` 工具负责按需取用
- 角色卡规定群聊裁剪策略：不念问卷、结论前置、不暴露工具、涉险转安全建议

**部署**

- `src/lib/config.mjs`：所有路径/群号/密钥统一走环境变量或 `.env`
- `install/check-prereqs.ps1`：逐项检查依赖，缺什么直接说缺什么
- `install/setup-python.ps1`：建两个 Python 环境（工具 / RVC）
- `install/install.ps1`：装人格卡、注册 MCP、链接触军师 skill
- `install/register-tasks.ps1`：注册日记（23:30）与提醒（每分钟）计划任务
- `tests/smoke.mjs`：24 项自检

**文档**

- `docs/ARCHITECTURE.md`：数据流图、两条音频链路、多群隔离、踩坑表
- `docs/INSTALL.md`：10 步部署，含 fairseq 在 Windows 上的三个编译坑
- `docs/OPS.md`：健康检查、日志位置、故障排查、调参速查
- `docs/LIMITS.md`：许可边界、技术天花板、已知 bug 清单

### 已知问题

- RVC 唱歌时高音区仍可能破音（音色模型训练音域限制），换音色或降调可缓解
- 洛雪自动化的 DOM 选择器是硬编码的，客户端升级可能失效
- 翻唱任务没有断点续跑，中途失败需从头开始
- 补缝只能处理能量缺口，对音高破裂无效
- CPU 上 4 分钟的歌约需 20~25 分钟

### 不包含

- SnowLuma 本体（闭源，EULA 禁止自动部署，需自行安装与手动启动）
- RVC 音色模型（版权归原方，仅提供目录约定与加载代码）
- 任何个人凭据（`.env`、豆包 APP ID / Token、SnowLuma 令牌）
