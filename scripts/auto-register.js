#!/usr/bin/env node
/**
 * DSH Session Tag Manage - 自动注册脚本 (跨平台)
 *
 * 用途：自动安装宿主端和客户端插件到 DSH profile
 * 使用：在项目根目录执行 node scripts/auto-register.js
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

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
const hostDir = join(PROJECT_ROOT, 'packages', 'dsh-session-host')
const clientDir = join(PROJECT_ROOT, 'packages', 'dsh-session-client')

if (!existsSync(hostDir)) {
  console.error('[错误] 未找到宿主端插件目录: packages/dsh-session-host')
  process.exit(1)
}

if (!existsSync(clientDir)) {
  console.error('[错误] 未找到客户端插件目录: packages/dsh-session-client')
  process.exit(1)
}

// 构建插件
console.log('[1/4] 构建插件...')
try {
  execSync('pnpm build', { cwd: PROJECT_ROOT, stdio: 'inherit' })
  console.log('[完成] 插件构建成功')
  console.log('')
} catch {
  console.error('[错误] 构建失败')
  process.exit(1)
}

// 安装宿主端插件
console.log('[2/4] 安装宿主端插件...')
try {
  execSync(`dsh plugin --profile web add "${hostDir}"`, { stdio: 'inherit' })
  console.log('[完成] 宿主端插件安装成功')
  console.log('')
} catch {
  console.error('[错误] 宿主端插件安装失败')
  process.exit(1)
}

// 安装客户端插件
console.log('[3/4] 安装客户端插件...')
try {
  execSync(`dsh plugin --profile web add "${clientDir}"`, { stdio: 'inherit' })
  console.log('[完成] 客户端插件安装成功')
  console.log('')
} catch {
  console.error('[错误] 客户端插件安装失败')
  process.exit(1)
}

// 完成提示
console.log('[4/4] 注册完成')
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
