#!/usr/bin/env node
/** 从上游同步 goutoujunshi skill（保留本地的 README 和 LICENSE） */
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, cpSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const DEST = join(REPO, 'vendor', 'goutoujunshi')
const UPSTREAM = 'https://github.com/shengjidaguai-china/goutoujunshi'

const tmp = mkdtempSync(join(tmpdir(), 'junshi-'))
console.log('拉取上游…')
execFileSync('git', ['clone', '--depth', '1', UPSTREAM, join(tmp, 'repo')], { stdio: 'inherit' })

for (const part of ['SKILL.md', 'references', 'scripts']) {
  const src = join(tmp, 'repo', part)
  if (!existsSync(src)) continue
  const dst = join(DEST, part)
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  console.log('同步', part)
}
rmSync(tmp, { recursive: true, force: true })
console.log('完成。README 与 LICENSE 保持仓库内的版本。')