---
title: milky 适配器配置
description: 配置 Milky 协议端的连接实例
fields:
  - key: milky.instances
    label: 连接实例
    type: array
    description: 每个实例对应一个 Milky 协议端。可添加多个实例，机器人会同时连接。
    itemFields:
      - key: protocol
        label: 连接协议
        type: select
        description: http 未加密，https 加密（需协议端开启 TLS）。
        defaultValue: http
        options:
          - value: http
            label: http (未加密)
          - value: https
            label: https (加密)

      - key: host
        label: 主机地址
        type: text
        description: 协议端所在主机地址。
        placeholder: localhost

      - key: port
        label: 端口
        type: number
        description: 协议端 HTTP 服务端口，需与协议端配置一致。
        placeholder: 3000

      - key: prefix
        label: 路径前缀
        type: text
        description: 协议端服务挂载在子路径下时填写，例如 /milky；留空表示根路径。
        placeholder: 可空

      - key: token
        label: 访问令牌
        type: secret
        description: 协议端设置的 access_token，留空表示无令牌。
        placeholder: 可空

      - key: transport
        label: 事件推送方式
        type: select
        description: 通过 WebSocket 或 SSE 接收协议端推送的事件。
        defaultValue: websocket
        options:
          - value: websocket
            label: WebSocket
          - value: sse
            label: SSE

      - key: reconnect
        label: 断线自动重连
        type: switch
        description: 事件推送连接断开后是否自动重连。
        defaultValue: true

      - key: ignore_self
        label: 忽略自己账号的消息
        type: switch
        description: 是否忽略 bot 自己账号发出的消息。
        defaultValue: true
---

# milky 适配器配置

通过 [Milky](https://milky.ntqqrev.org/) 协议连接 QQ 协议端。每个连接实例对应一个协议端的 HTTP 服务，
API 调用走 `/api`，事件推送走 `/event`

```mioku-field
key: milky.instances
```
