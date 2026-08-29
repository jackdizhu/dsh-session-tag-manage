/**
 * @deepseek-ai 包模拟类型定义
 *
 * 用于本地开发和测试，实际运行时由 DSH 宿主框架提供
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    webServer: {
      // 与 @deepseek-ai/dsh-host-webserver 运行时一致：register 接收路由对象
      // { kind, path, handler }，handler 收到 node:http 的 IncomingMessage / ServerResponse。
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: any, res: any) => void
      }): void
    }
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  // 空模块声明
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface ClientContext {
    slots: any
    sessions: {
      list: {
        getSnapshot(): { items: Array<{ sessionId: string; running: boolean; title?: string }> }
        subscribe(callback: () => void): () => void
      }
      selection: {
        getSnapshot(): { sessionId: string | null }
        subscribe(callback: () => void): () => void
      }
    }
    workspaces: {
      list: {
        getSnapshot(): { items: Array<{ workspaceId: string; title: string; path: string; sessionIds?: string[] }> }
        subscribe(callback: () => void): () => void
      }
    }
  }
}
