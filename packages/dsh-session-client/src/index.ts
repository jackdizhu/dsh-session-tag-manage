/**
 * 客户端插件入口
 *
 * 在 DOM 节点区域创建 Canvas 元素，绘制蓝色矩形块支持点击，
 * 点击后控制台打印点击事件与时间日志。
 *
 * @module dsh-session-base-client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-base-client'

/** 注入依赖列表 */
export const inject = ['slots']

/**
 * 插件应用函数
 * @param _ctx - 客户端上下文
 */
export function apply(_ctx: ClientContext) {
  // 查找目标 DOM 容器
  const container = document.querySelector('[data-session-row]') ?? document.body

  // 创建 Canvas 元素
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 60
  canvas.style.cssText = 'cursor: pointer; margin: 8px;'

  // 绘制蓝色块
  const ctx2d = canvas.getContext('2d')
  if (ctx2d) {
    ctx2d.fillStyle = '#3b82f6'
    ctx2d.fillRect(0, 0, 100, 60)
  }

  // 绑定点击事件
  canvas.addEventListener('click', (event) => {
    console.log('[SessionTag] Canvas clicked:', {
      type: event.type,
      time: new Date().toLocaleString(),
      x: event.offsetX,
      y: event.offsetY,
    })
  })

  container.appendChild(canvas)
}
