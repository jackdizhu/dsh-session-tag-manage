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
  // 客户端插件 Node 半区（ESM）：空插件，让 loader 条目在宿主侧挂载成功
  {
    entry: ['packages/dsh-session-client/src/host.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'esm',
    target: 'es2024',
  },
  // 客户端插件浏览器半区（CJS 主体）
  // 注意：DSH 客户端模块系统要求 bundle 以
  //   window.__ModuleLoader__.load({ id, factory(require) { ... return module.exports } })
  // 形式自注册；tsdown 不支持 footer，注册包装由 scripts/wrap-client-bundle.mjs 在构建后统一拼接。
  {
    entry: ['packages/dsh-session-client/src/index.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'cjs',
    target: 'es2024',
  },
])
