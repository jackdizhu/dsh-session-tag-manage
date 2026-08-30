#!/usr/bin/env node
/**
 * DSH Skills Auto Enable - 自动注册脚本 (跨平台)
 *
 * 用途：构建并注册 dsh-skills-auto-enable 宿主端插件到 DSH profile
 * 使用：在项目根目录执行 node scripts/auto-register.js
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

// DSH profile 配置目录（支持 DSH_HOME 覆盖，默认 ~/.dsh）
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

// 仅注册这一个插件：dsh-skills-auto-enable（宿主端，带 dsh.bundle.patch）
const PLUGIN_DIR = join(PROJECT_ROOT, 'packages', 'dsh-skills-auto-enable')

console.log('========================================')
console.log('DSH Skills Auto Enable - 自动注册')
console.log('========================================')
console.log('')
console.log(`项目根目录: ${PROJECT_ROOT}`)
console.log(`目标插件:   dsh-skills-auto-enable`)
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
  console.error('[错误] 未找到插件目录: packages/dsh-skills-auto-enable')
  process.exit(1)
}

// [1/2] 构建插件
console.log('[1/2] 构建插件...')
try {
  execSync('pnpm build', { cwd: PROJECT_ROOT, stdio: 'inherit' })
  console.log('[完成] 插件构建成功')
  console.log('')
} catch {
  console.error('[错误] 构建失败')
  process.exit(1)
}

// [2/2] 安装插件（其 cordis.patch.yml 随 dsh plugin add 自动编入 host bundle）
console.log('[2/2] 安装 dsh-skills-auto-enable 插件...')
try {
  execSync(`dsh plugin --profile web add "${PLUGIN_DIR}"`, { stdio: 'inherit' })
  console.log('[完成] 插件安装成功')
  console.log('')
} catch {
  console.error('[错误] 插件安装失败')
  process.exit(1)
}

console.log('========================================')
console.log('插件注册成功！')
console.log('========================================')
console.log('')
console.log(`DSH profile: ${DSH_HOME}/profiles/web`)
console.log('')
console.log('启动 DSH:')
console.log('  dsh web')
console.log('')
console.log('注意：安装后需要重启 DSH 才能生效')
console.log('========================================')
