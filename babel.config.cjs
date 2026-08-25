/**
 * Babel 配置（CommonJS）：@deepseek-ai 插件标准装饰器编译链路。
 *
 * - @babel/preset-typescript：剥离类型（allowDeclareFields 兼容 declare 字段语法）。
 * - @babel/plugin-proposal-decorators（version "2023-11"）：TC39 标准装饰器，
 *   与 @deepseek-ai 官方插件（dsh-goal 等）编译形态一致 → 产物合法、Node 可运行。
 * - @babel/plugin-transform-class-properties：配合 2023-11 装饰器处理类字段。
 * - rewrite-ts-imports：仅产物层把相对 `.ts` 导入改写为 `.js`（源码保留 `.ts`）。
 */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
    plugins: [
      ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
      '@babel/plugin-transform-class-static-block',
      '@babel/plugin-transform-class-properties',
      require('./scripts/rewrite-ts-imports.cjs'),
    ],
  }
}