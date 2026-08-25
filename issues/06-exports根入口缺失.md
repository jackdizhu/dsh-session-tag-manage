---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] 新增 exports 后缺少根入口 "."，导致 ERR_PACKAGE_PATH_NOT_EXPORTED'
labels: ['bug']
assignees: ''
---

## 描述缺陷

为满足 `dsh-client-modules` 新增 `exports["./client"]` 后，`exports` 字段未声明根入口 `"."`。由于 Node 的 `main` 仅在 `exports` 缺席时生效，一旦存在 `exports`，包根路径（`require('dsh-session-tag-manage')`）就会因找不到导出而被拒绝，loader 无法导入插件主入口。

## 复现步骤

1. 先在 `package.json` 中仅添加 `"exports": { "./client": "./dist/client.js" }`
2. 启动 `dsh web`
3. 看到如下报错：`No "exports" main defined in ...\dsh-session-tag-manage\package.json`
4. 插件入口加载失败

## 预期行为

`exports` 同时声明根入口 `"."` 指向构建产物 `./dist/index.js`，loader 能正常导入插件主入口。

## 实际行为

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in
C:\Users\jackdizhu\.dsh\profiles\web\node_modules\dsh-session-tag-manage\package.json
imported from C:\Users\jackdizhu\.dsh\profiles\web\
```

## 环境信息

- dsh 版本：`dsh --version`（dsh-app-boot 的 cordis-plugin-loader）
- 插件版本：`dsh-session-tag-manage` v0.1.0
- Node.js：v24.13.1

## 日志 / 报错

见「实际行为」中的错误信息（`ERR_PACKAGE_PATH_NOT_EXPORTED` / `exportsNotFound` / `packageExportsResolve`）。

## 根因与解决

- **根因**：Node 的包导出解析规则——当 `package.json` 出现 `exports` 字段时，根路径解析以 `exports["."]` 为准，`main` 字段不再兜底。只导出 `"./client"` 而未导出 `"."` 导致根导入被拒。
- **解决**：在 `exports` 中补充根入口 `"."`。

```json
"exports": {
  ".": "./dist/index.js",
  "./client": "./dist/client.js"
}
```

## 其他补充

- 涉及文件：[package.json](file:///c:/global-user-data/ai-workspace/dsh-session-tag-manage/package.json)（`exports` 字段）。
- 修复后 `dsh web` 成功启动，监听 `http://127.0.0.1:3080`，插件树与客户端组合均通过。