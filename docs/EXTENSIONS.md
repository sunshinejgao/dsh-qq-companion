# 可选扩展

本仓库的核心是「人格 + 语音 + 翻唱 + 日记 + 提醒 + 情感军师」。下面这些能力**不是本仓库的代码**，但常和它配合使用——这里说清楚边界，免得误以为仓库里包含了它们。

## 一、刷 B 站 + 自动评论（第三方插件）

**这不是本仓库的代码。** 它来自 npm 包 [`dsh-bili-scroll`](https://www.npmjs.com/package/dsh-bili-scroll)（插件作者另行维护），提供一整套 B 站工具：

| 工具 | 作用 |
|---|---|
| `bili_search` | 搜视频（按播放/最新/弹幕排序） |
| `bili_subtitle` | 取 AI 字幕全文（判断内容质量靠它，不看摘要） |
| `bili_comments` | 取热门评论 |
| `bili_whoami` / `bili_status` / `bili_config` | 登录状态、今日额度、设置 |
| `bili_reply` | 在视频下发评论（**默认关闭**，需人工确认） |
| `bili_run` | 立刻跑一轮，不等时间窗口 |

它跑起来的样子是：按设定时间窗口抓一批视频 → 读字幕 → 挑出值得看的 → 写成一份日报；可选地把日报发到 QQ（私聊或群）。

### 怎么装

```powershell
cd <你的 DSH profile 目录>
npm install dsh-bili-scroll
```

然后在 `cordis.patch.yml` 里加一段（**注意放在 qq-bridge 的 BEGIN/END 区块之外**）：

```yaml
- id: bili-scroll
  name: dsh-bili-scroll
  config:
    enabled: true
    peakValley: true          # 只在闲时跑，省额度
    autoComment: false        # 自动评论默认关闭，别开
    dmMode: only              # off / only / both —— 日报投递方式
    mentionName: <你想要的称呼>
    keywords:
      - ai前言科技；音乐
    pythonPath: <基础环境的 python.exe>
    personaPrompt: |-
      <这里写"这一轮我在干什么"，比如：
       我在给板板刷 B 站：搜、读字幕、挑出值得的、写成日报。
       日报是写给他看的，不是我的心情日记。>
```

它还需要一个独立的 Python 环境（字幕转写、本地转码）：

```powershell
uv venv C:\Users\<你>\.dsh\bili-duty\.venv
uv pip install --python C:\Users\<你>\.dsh\bili-duty\.venv\Scripts\python.exe edge-tts imageio-ffmpeg
```

> 首次用之前，在插件的设置页扫码登录 B 站；`bili_setup` 会建独立 venv 并装依赖（几分钟，看 `install.log`）。

### 和本仓库的关系

**没有代码依赖**，只是同一个 Agent 里多挂一个 MCP server。它和人格卡的关系是：

- 它有自己的 `personaPrompt`（"这一轮我在干什么"），属于**任务层**
- 本仓库的 `roles/肥嘟嘟.md` 是**人物层**（她是谁、什么脾气）

两层叠加的效果是：她用同一个人格去写 B 站日报，但日报的文体由任务层管。

### 踩过的坑

| 现象 | 原因 |
|---|---|
| `bili_setup` 起完就返回，没装完 | 它不等安装结束，进度看插件家目录的 `install.log` |
| 字幕取不到就跳过 | 正常设计；开了「本地转写」才会兜底 |
| 评论发不出去 | 设置页「自动评论并 @ 你」默认关闭，属安全闸 |
| 日报发到 QQ 却没收到 | `dmMode` 要设对（`off` / `only` / `both`），且要登录有效 |

## 二、发消息到 QQ（这是基础设施，不是本仓库的功能）

「能把消息发到 QQ」这件事**是 qq-bridge 提供的**，不是我们写的。

它在 DSH 里注册了一整套 MCP 工具：

```text
qq_send_message      发一条或多条（可选引用、@ 人、间隔控制）
qq_send_group_message / qq_send_private_message
qq_reply             引用某条消息回复
qq_send_burst        分多条连发（真人节奏）
qq_get_unread_messages / qq_get_recent_messages
qq_get_message_images / qq_get_forward_msg
qq_set_wake_config   设置什么时候叫醒 AI
qq_mark_read         标记已读
```

本仓库做的事是**在它之上加能力**：

```text
qq-bridge 提供「怎么发」
  ↓
本仓库提供「发什么」：
  voice_say     → 发一条语音（豆包 TTS + RVC）
  cover_song    → 发一段翻唱
```

所以：

- 想只发文字/图片/表情 → 用 qq-bridge 自带工具，本仓库不用装
- 想发**她的声音**或**她唱的歌** → 才需要本仓库

## 三、还有哪些能力来自第三方

| 能力 | 来自 | 本仓库做了什么 |
|---|---|---|
| QQ 收发、群管理 | qq-bridge（MIT） | 只加工具，不改它 |
| QQ 协议接入 | SnowLuma（闭源） | 完全不碰，文档要求手动安装启动 |
| Agent 运行时 | DeepSeek Harness | 通过 MCP 挂工具 |
| B 站刷视频/日报 | `dsh-bili-scroll`（npm） | 不包含，只写接入说明 |
| 情感军师知识库 | [goutoujunshi](https://github.com/shengjidaguai-china/goutoujunshi)（MIT） | 内置并包了一层工具 |
| 人声分离 | demucs | 调它，写参数 |
| 音色转换 | RVC / rvc-python | 包了常驻服务 + 参数调优 + 修复链 |

## 要不要把这些也写进仓库

**B 站插件**：不写代码，但可以在 README 里加一句"另外还可以接 `dsh-bili-scroll` 做 B 站日报"。

**QQ 工具**：本来就在依赖里，README 的技术栈表已经列了 qq-bridge。

如果你希望仓库自带一个"一键接 B 站"的脚本，那要处理它的登录、额度、时间窗口，而且它的接口属于另一个维护者——**建议不做**，保持"我们只管人格和声音"这条边界更清楚。
