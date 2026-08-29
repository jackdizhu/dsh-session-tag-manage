# dsh-session-client

> 插件命名：dsh-session-tag-manage-client

## 概述

DSH 会话管理插件的客户端实现，在 DOM 节点区域创建 Canvas 元素并处理交互事件。

## 功能说明

### 基础设计

1. **Canvas 创建**：在目标 DOM 容器中创建 Canvas 元素（100x60px）
2. **蓝色块绘制**：Canvas 2D 绘制蓝色矩形块（#3b82f6）
3. **点击事件**：点击后控制台输出日志：
   ```
   [SessionTag] Canvas clicked: { type: 'click', time: '...', x: ..., y: ... }
   ```
4. **DOM 定位**：使用稳定的 DOM 选择器（`data-session-row`），降级到 `document.body`
   - 参考实现：`docs/dsh-tidychat.md`

### 扩展设计

5. **HTTP 接口调用**：点击后调用 `dsh-session-host` HTTP 接口
6. **响应日志**：接口响应后控制台打印响应数据

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 构建
pnpm build

# 运行测试
pnpm test
```

## 测试

```bash
# 运行客户端测试
pnpm test --filter dsh-session-tag-manage-client
```

测试用例位于 `__tests__/index.test.ts`，覆盖：
- 插件规范导出（name、inject）
- Canvas 创建与尺寸验证
- 样式设置验证
- 点击事件绑定验证
- 日志输出格式验证
