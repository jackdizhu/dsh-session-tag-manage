# dsh-session-client

> 插件命名：dsh-session-base-client

## 基础设计

1. web客户端功能，参考`docs/dsh-tidychat.md`实现
1.1 在同dom节点区域创建canvas
1.2 绘制蓝色块支持点击
1.3 点击后，在控制台log打印点击事件、点击时间日志信息


## 扩展设计

1.4 点击后，调用`dsh-session-host`, HTTP 接口
1.5 调用接口响应后，在控制台log打印接口响应数据日志信息

