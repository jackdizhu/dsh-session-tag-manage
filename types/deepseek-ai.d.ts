/**
 * @deepseek-ai 包模拟类型定义
 *
 * 用于本地开发和测试，实际运行时由 DSH 宿主框架提供
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    webServer: {
      register(path: string, handler: (req: any, res: any) => void): void
    }
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  // 空模块声明
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface ClientContext {
    slots: any
  }
}
