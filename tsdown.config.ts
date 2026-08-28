import { defineConfig } from 'tsdown'

export default defineConfig([
  // 宿主端产物（ESM）
  {
    entry: ['packages/dsh-session-host/src/index.ts'],
    outDir: 'packages/dsh-session-host/dist',
    format: 'esm',
    target: 'es2024',
    external: ['@deepseek-ai/*'],
  },
  // 客户端产物（CJS）
  {
    entry: ['packages/dsh-session-client/src/index.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'cjs',
    banner: {
      js: `window.__ModuleLoader__ = window.__ModuleLoader__ || { load(opts) { var m = { exports: {} }; opts.factory(function(id){return require(id)}, m); return m.exports; } };`,
    },
  },
])
