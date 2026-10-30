# goutoujunshi

本目录是 [goutoujunshi](https://github.com/shengjidaguai-china/goutoujunshi) 的同步副本，
用于让 QQ 群里的角色在「感情问题」场景下调用它，作者 **powerycy**，**MIT 许可**（见同目录 LICENSE）。

## 为什么内置而不是子模块

部署目标是"一台机器、离线可用"。子模块要求部署时能访问 GitHub，而这份 skill 只有 ~350 KB，
直接内置更省事。

## 怎么同步上游

```powershell
node scripts/sync-junshi.mjs
```

它会重新拉取上游最新版本并覆盖本目录（保留本 README 与 LICENSE）。

## 本仓库对它的改动

**无。** `SKILL.md` 与 `references/` 内容一字未改。
调用方式由 `src/mcp-diary.js` 里的 `junshi` 工具承载：不带参数返回总纲，带 `ref` 返回某一篇专题。

## 上游内容说明

上游作者在文件末尾注明「文档部分内容可能由 AI 生成」。参考库篇幅很大（43 篇），
质量和循证程度不一——我们只在角色卡里要求「用框架思考」，不要求照念原文。