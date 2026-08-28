# dsh-session-host

> 插件命名：dsh-session-base-host

## 基础设计

1. 宿主端功能，参考`doss/dsh-session-manager.md`实现
1.1 实现一个HTTP 接口，/dsh-session-host-test
1.2 调用接口，参数：无，返回当前服务端时间


## 扩展设计

1.3 实现一个HTTP 接口，/dsh-session-host-get 
1.4 调用接口，参数：工作区，返回当前工作区`session`会话数量
