#!/usr/bin/env node
/**
 * DSH Session Tag Manage - 自动注册脚本 (跨平台)
 *
 * 用途：自动安装宿主端和客户端插件到 DSH profile
 * 使用：在项目根目录执行 node scripts/auto-register.js
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

// DSH profile 配置目录（支持 DSH_HOME 覆盖，默认 ~/.dsh）
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DSH_PROFILE_DIR = join(DSH_HOME, 'profiles', 'web')
const PROFILE_PATCH_PATH = join(DSH_PROFILE_DIR, 'cordis.patch.yml')

// 客户端插件 loader 条目 id（与 cordis.patch.yml / wrap-client-bundle.mjs 保持一致）
const CLIENT_LOADER_ID = 'dsh-plugin-client-template'

console.log('========================================')
console.log('DSH Session Tag Manage - 自动注册')
console.log('========================================')
console.log('')
console.log(`项目根目录: ${PROJECT_ROOT}`)
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
const hostDir = join(PROJECT_ROOT, 'packages', 'dsh-plugin-host-template')
const clientDir = join(PROJECT_ROOT, 'packages', 'dsh-plugin-client-template')

if (!existsSync(hostDir)) {
  console.error('[错误] 未找到宿主端插件目录: packages/dsh-plugin-host-template')
  process.exit(1)
}

if (!existsSync(clientDir)) {
  console.error('[错误] 未找到客户端插件目录: packages/dsh-plugin-client-template')
  process.exit(1)
}

/**
 * 幂等写入客户端插件 loader 条目到 profile 的 cordis.patch.yml。
 *
 * 背景：`dsh plugin add` 只是转发给 pnpm，只会维护 package.json 的
 * dependencies 与 dsh.profile.bundles。客户端插件仅声明 dsh.client（无
 * dsh.bundle），不会进入 bundles，需在 profile 的 cordis.patch.yml 手动
 * insert 才能被 dsh-client-modules 编入 window.__DSH_BOOT__ 图。
 *
 * 示例（目标格式，与当前手写条目一致）：
 *   - insert:
 *       - id: dsh-plugin-client-template
 *         name: dsh-plugin-client-template
 */
function ensureClientPatchEntry() {
  console.log('[4/5] 校验 profile patch（客户端插件条目）...')

  // 幂等判断：文件中已存在对应 loader 条目则跳过，避免重复写入
  const existing = existsSync(PROFILE_PATCH_PATH)
    ? readFileSync(PROFILE_PATCH_PATH, 'utf8')
    : ''
  if (new RegExp(`- id: ${CLIENT_LOADER_ID}\\b`).test(existing)) {
    console.log('[跳过] cordis.patch.yml 已包含客户端插件条目')
    return
  }

  const entry = [
    '',
    '# 客户端插件（由 auto-register 脚本幂等维护）：',
    '- insert:',
    `    - id: ${CLIENT_LOADER_ID}`,
    `      name: ${CLIENT_LOADER_ID}`,
    '',
  ].join('\n')

  // 目录兜底（正常情况下 dsh plugin add 已初始化 profile）
  mkdirSync(DSH_PROFILE_DIR, { recursive: true })

  // 拼接后整体写回，避免 appendFileSync 的换行边界问题
  const updated = existing === '' || existing.endsWith('\n')
    ? existing + entry
    : existing + '\n' + entry
  writeFileSync(PROFILE_PATCH_PATH, updated)
  console.log(`[完成] 已写入客户端插件条目: ${PROFILE_PATCH_PATH}`)
}

// 构建插件
console.log('[1/5] 构建插件...')
try {
  execSync('pnpm build', { cwd: PROJECT_ROOT, stdio: 'inherit' })
  console.log('[完成] 插件构建成功')
  console.log('')
} catch {
  console.error('[错误] 构建失败')
  process.exit(1)
}

// 安装宿主端插件
console.log('[2/5] 安装宿主端插件...')
try {
  execSync(`dsh plugin --profile web add "${hostDir}"`, { stdio: 'inherit' })
  console.log('[完成] 宿主端插件安装成功')
  console.log('')
} catch {
  console.error('[错误] 宿主端插件安装失败')
  process.exit(1)
}

// 安装客户端插件
console.log('[3/5] 安装客户端插件...')
try {
  execSync(`dsh plugin --profile web add "${clientDir}"`, { stdio: 'inherit' })
  console.log('[完成] 客户端插件安装成功')
  console.log('')
} catch {
  console.error('[错误] 客户端插件安装失败')
  process.exit(1)
}

// 幂等写入客户端插件 patch 条目（核心修复：保证 client 始终被 dsh-client-modules 挂载）
ensureClientPatchEntry()

// 完成提示
console.log('[5/5] 注册完成')
console.log('')
console.log('========================================')
console.log('插件注册成功！')
console.log('========================================')
console.log('')
console.log('启动 DSH:')
console.log('  dsh web')
console.log('')
console.log('或使用本地开发模式（仅宿主端）:')
console.log('  pnpm run dev')
console.log('')
console.log('注意：安装后需要重启 DSH 才能生效')
console.log('========================================')
