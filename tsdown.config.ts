import { defineConfig } from 'tsdown'

export default defineConfig({
  // 宿主端产物（ESM）：构建 dsh-debugger 单包
  entry: ['packages/dsh-debugger/src/index.ts'],
  outDir: 'packages/dsh-debugger/dist',
  format: 'esm',
  target: 'es2024',
  external: ['@deepseek-ai/*'],
})
