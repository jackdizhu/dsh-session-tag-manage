#!/usr/bin/env node
/**
 * DSH Session Tag Manage - dsh-debugger 自动注册脚本（跨平台）
 *
 * 用途：构建 dsh-debugger 并注册到全部目标 DSH profile（web + headless）
 * 使用：在项目根目录执行 node scripts/auto-register.js
 *
 * 插件在每个 profile 的生效条件（二者缺一不可）：
 *   1) node_modules 中有指向插件源码目录的 junction（`dsh plugin add` 维护）
 *   2) cordis.patch.yml 中有 `- insert: - id/name: dsh-debugger` 条目（本脚本幂等维护）
 *
 * 构建说明：根 `pnpm build` 的 tsdown 入口仍指向已删除的旧包（不可用），
 * 因此这里以插件包目录为 cwd 直跑单包 tsdown 命令。
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

// 插件包与 patch 条目 id（须与 packages/dsh-debugger/cordis.patch.yml 一致）
const PLUGIN_ID = 'dsh-debugger'
const PLUGIN_DIR = join(PROJECT_ROOT, 'packages', 'dsh-debugger')

// 目标 profile 列表：web 与 headless 各自独立目录，插件须分别注册
// （Web 端 /debugger 指令依赖 web profile；headless pre-step 兜底依赖 headless profile）
const PROFILES = ['web', 'headless']

// DSH profile 根目录（支持 DSH_HOME 覆盖，默认 ~/.dsh）
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

console.log('========================================')
console.log('DSH Session Tag Manage - dsh-debugger 自动注册')
console.log('========================================')
console.log('')
console.log(`项目根目录: ${PROJECT_ROOT}`)
console.log(`插件目录:   ${PLUGIN_DIR}`)
console.log(`目标 profile: ${PROFILES.join(', ')}`)
console.log('')

// 检查 dsh 命令是否可用
try {
  execSync('dsh --version', { stdio: 'ignore' })
} catch {
  console.error('[错误] 未找到 dsh 命令，请先安装 DeepSeek Harness')
  console.error('安装命令: npm install -g @deepseek-ai/dsh')
  process.exit(1)
}

// 检查插件目录是否存在
if (!existsSync(PLUGIN_DIR)) {
  console.error(`[错误] 未找到插件目录: packages/dsh-debugger`)
  process.exit(1)
}

/**
 * 幂等写入插件条目到 profile 的 cordis.patch.yml。
 *
 * 幂等策略（三段式，与旧版客户端条目逻辑一致）：
 *   1) 文件已含 `- id: dsh-debugger` 子条目 → 跳过；
 *   2) 存在「空 insert 块」（- insert: 后无缩进子条目，多为 dsh 序列化
 *      剥离后的残留）→ 填充首个空块并清理其余重复空块，避免堆积；
 *   3) 完全不存在 insert → 追加新块。
 */
function findEmptyInsertBlockLines(text) {
  const lines = text.split(/\r?\n/)
  const result = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^[ \t]*- insert:[ \t]*$/.test(lines[i])) continue
    // 向后扫描：跳过注释与空行，遇缩进子条目则非空，遇顶层元素或结尾则结束
    let isEmpty = true
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      if (/^[ \t]+/.test(lines[j])) isEmpty = false
      break
    }
    if (isEmpty) result.push(i)
  }
  return result
}

function ensurePatchEntry(profileDir) {
  const patchPath = join(profileDir, 'cordis.patch.yml')

  // 幂等判断①：已存在目标 id 条目则跳过，避免重复写入
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  if (new RegExp(`- id: ${PLUGIN_ID}\\b`).test(existing)) {
    console.log(`[跳过] ${patchPath} 已包含 ${PLUGIN_ID} 条目`)
    return
  }

  // 目录兜底（正常情况下 dsh plugin add 已初始化 profile）
  mkdirSync(profileDir, { recursive: true })

  // 幂等判断②：存在空 insert 块 → 填充首个并移除其余，防止重复堆积
  const emptyInsertLines = findEmptyInsertBlockLines(existing)
  if (emptyInsertLines.length > 0) {
    const lines = existing.split(/\r?\n/)
    const dropLines = new Set(emptyInsertLines.slice(1))
    const rebuilt = []
    for (let idx = 0; idx < lines.length; idx++) {
      if (idx === emptyInsertLines[0]) {
        rebuilt.push(lines[idx])
        rebuilt.push(`    - id: ${PLUGIN_ID}`)
        rebuilt.push(`      name: ${PLUGIN_ID}`)
      } else if (!dropLines.has(idx)) {
        rebuilt.push(lines[idx])
      }
    }
    writeFileSync(patchPath, rebuilt.join('\n'))
    console.log(`[完成] 已填充 ${PLUGIN_ID} 条目并清理重复空块: ${patchPath}`)
    return
  }

  // 幂等判断③：完全不存在 insert → 追加新块
  const entry = [
    '',
    `# ${PLUGIN_ID}（由 auto-register 脚本幂等维护）：`,
    '- insert:',
    `    - id: ${PLUGIN_ID}`,
    `      name: ${PLUGIN_ID}`,
    '',
  ].join('\n')

  const updated = existing === '' || existing.endsWith('\n')
    ? existing + entry
    : existing + '\n' + entry
  writeFileSync(patchPath, updated)
  console.log(`[完成] 已写入 ${PLUGIN_ID} 条目: ${patchPath}`)
}

// 构建插件（单包 tsdown，cwd 必须为插件包目录）
console.log('[1/3] 构建 dsh-debugger...')
try {
  execSync(
    'node ../../node_modules/tsdown/dist/run.js src/index.ts --outDir dist --format esm --target es2024 --external "@deepseek-ai/*"',
    { cwd: PLUGIN_DIR, stdio: 'inherit' },
  )
  console.log('[完成] 插件构建成功')
  console.log('')
} catch {
  console.error('[错误] 构建失败')
  process.exit(1)
}

// 逐 profile：安装（junction）+ 幂等 patch
for (const profile of PROFILES) {
  console.log(`[2/3] 注册到 profile "${profile}"...`)
  const profileDir = join(DSH_HOME, 'profiles', profile)
  const junctionPath = join(profileDir, 'node_modules', PLUGIN_ID)
  if (existsSync(junctionPath)) {
    // junction 已存在（历史注册）：跳过 pnpm 安装，避免环境差异
    // （如 pnpm store 位置变更导致的 ERR_PNPM_UNEXPECTED_STORE）误伤幂等注册
    console.log(`[跳过] junction 已存在: ${junctionPath}`)
  } else {
    try {
      execSync(`dsh plugin --profile ${profile} add "${PLUGIN_DIR}"`, { stdio: 'inherit' })
      console.log(`[完成] ${profile} profile 插件安装成功`)
    } catch {
      console.error(`[错误] ${profile} profile 插件安装失败`)
      console.error('[提示] 若为 pnpm store 位置变更（ERR_PNPM_UNEXPECTED_STORE），')
      console.error('       可在 profile 目录重跑 "pnpm install" 或执行 pnpm config set store-dir 对齐历史 store。')
      process.exit(1)
    }
  }
  ensurePatchEntry(profileDir)
  console.log('')
}

// 完成提示
console.log('[3/3] 注册完成')
console.log('')
console.log('========================================')
console.log('dsh-debugger 注册成功！')
console.log('========================================')
console.log('')
console.log('使用方式:')
console.log('  Web/CLI:  /debugger [on|off|status]   （无参数等同 on；会话级，默认关闭）')
console.log('  headless: 整条消息为 /debugger on|off  时由 pre-step 兜底识别')
console.log('')
console.log('注意：安装后需要重启 DSH 才能生效')
console.log('========================================')
