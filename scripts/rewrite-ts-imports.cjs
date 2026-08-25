/**
 * Babel 产物插件：把相对导入/导出的 `.ts` 后缀改写为 `.js`。
 *
 * 背景：
 * - 源码保留 `.ts` 后缀导入（可读性 + tsc allowImportingTsExtensions）。
 * - Babel 仅转换 type/decorator，不重写 specifier；产物为 `.js` 文件，
 *   若保留 `./x.ts` 引用，Node ESM 会去找不存在的 `dist/x.ts`。
 * - 本插件在编译输出层将相对 specifier 的 `.ts` → `.js`，使产物可在 Node 下解析；
 *   仅处理相对路径（./ 、../），不触碰裸模块（@deepseek-ai/*、zod 等）。
 */
module.exports = function rewriteTsImports() {
  return {
    name: 'rewrite-ts-imports',
    visitor: {
      ImportDeclaration: fixSource,
      ExportNamedDeclaration: fixSourceOptional,
      ExportAllDeclaration: fixSource,
    },
  }
}

/** 把相对 specifier 的 `.ts` 替换为 `.js`（必须存在 source）。 */
function fixSource(path) {
  const src = path.node.source
  if (!src || !relativeOf(src.value)) return
  src.value = src.value.replace(/\.ts$/, '.js')
}

/** 导出语句的 source 可能为空（无 source 的导出），需判空。 */
function fixSourceOptional(path) {
  if (path.node.source) fixSource(path)
}

/** 判断是否为相对路径 specifier。 */
function relativeOf(value) {
  return /^\.{1,2}\//.test(value)
}