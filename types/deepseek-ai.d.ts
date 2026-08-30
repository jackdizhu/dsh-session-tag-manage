/**
 * @deepseek-ai 包模拟类型定义
 *
 * 用于本地开发和测试，实际运行时由 DSH 宿主框架提供。
 * 宿主端包（cordis、dsh-storage-domain）已作为 devDependency 安装，
 * 类型由各包自带。此处仅声明：
 * - webServer：运行时由 dsh-host-webserver 提供，但类型未声明
 * - dsh-client-runtime 客户端类型
 */

/** 宿主 HTTP 路由服务（运行时由 dsh-host-webserver 提供） */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
      }): void
    }
  }
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
