# mioku-adapter-milky

[mioku](https://github.com/mioku-lab/mioku) 的 [Milky](https://milky.ntqqrev.org/) 协议适配器：通过 HTTP 调用协议端 API，通过 WebSocket 或 SSE 接收事件推送。

## 特性

- 基于 Milky 1.3 协议实现，支持多实例同时连接
- 事件推送支持 WebSocket（默认）与 SSE，断线后按指数退避自动重连
- 实现 mioku 全部内置能力：消息收发 / 撤回 / 获取、合并转发、历史消息、群与成员管理、好友管理、资料设置、状态上报
- 按 Milky 兼容性规范处理未知事件与未知消息段，协议端升级后不会报错

## 安装与启用

```bash
bun add mioku-adapter-milky
```

在项目根目录运行 `bunx mioku-adapter-milky` 可交互式生成配置，也可以手动写入 `package.json`：

```json
{
  "mioku": {
    "adapters": {
      "milky": {
        "instances": [
          {
            "host": "127.0.0.1",
            "port": 3000,
            "token": "your_access_token"
          }
        ]
      }
    }
  }
}
```

## 配置

| 字段                   | 类型                     | 默认值        | 说明                                      |
| ---------------------- | ------------------------ | ------------- | ----------------------------------------- |
| `protocol`             | `"http"` \| `"https"`    | `"http"`      | 协议端 HTTP 服务的协议                    |
| `host`                 | string                   | `"localhost"` | 协议端主机地址                            |
| `port`                 | number                   | `3000`        | 协议端 HTTP 服务端口，需与协议端配置一致  |
| `prefix`               | string                   | `""`          | 协议端服务挂载的路径前缀，如 `/milky`     |
| `token`                | string                   | -             | 协议端配置的 `access_token`               |
| `transport`            | `"websocket"` \| `"sse"` | `"websocket"` | 事件推送方式                              |
| `reconnect`            | boolean                  | `true`        | 断线后是否自动重连                        |
| `reconnectInterval`    | number                   | `1000`        | 首次重连间隔（毫秒），之后按指数退避      |
| `maxReconnectAttempts` | number                   | 不限          | 最大连续重连次数                          |
| `maxReconnectInterval` | number                   | `30000`       | 重连间隔上限（毫秒）                      |
| `timeout`              | number                   | `30000`       | API 请求超时（毫秒）                      |
| `ignore_self`          | boolean                  | `true`        | 是否忽略 bot 自己账号发出的消息           |

WebSocket 连接通过 `access_token` 查询参数鉴权，API 调用与 SSE 连接通过 `Authorization: Bearer` 请求头鉴权。暂不支持 WebHook 推送方式。

## 消息 ID

Milky 用「消息场景 + 会话 ID + 消息序列号」定位一条消息，适配器将其编码为 `scene:peer_id:message_seq` 形式的字符串，例如 `group:123456:789`。`event.message_id`、`event.quote_id` 以及发送消息的返回值都使用这一格式，可直接用于撤回、获取消息和引用回复。

## 消息段对照

| Milky                        | mioku       | 说明                                                   |
| ---------------------------- | ----------- | ------------------------------------------------------ |
| `text`                       | `text`      |                                                        |
| `mention` / `mention_all`    | `at`        | `data.qq` 为 QQ 号或 `all`                             |
| `face`                       | `face`      | `data.id` 为表情 ID                                    |
| `reply`                      | -           | 不进入消息段，转为 `event.quote_id`                    |
| `image` / `record` / `video` | 同名        | `data.url` 为临时链接，`data.resource_id` 为资源 ID    |
| `file`                       | `file`      | 发送时自动改为调用文件上传 API                         |
| `forward`                    | `forward`   | 发送 `node` 段时自动合并为一条合并转发                 |
| `market_face`                | `mface`     |                                                        |
| `light_app`                  | `json`      |                                                        |
| `xml`                        | `xml`       | 仅接收                                                 |
| `markdown`                   | `markdown`  | 仅接收，发送时退化为文本                               |

Milky 不支持发送的消息段（如 `poke`、`music`、`button`）会被忽略并记录警告。

## 事件对照

| Milky 事件                                          | mioku 路由                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `message_receive`                                   | `message.group` / `message.private.friend` / `message.private.temp`      |
| `message_recall`                                    | `notice.group.recall` / `notice.friend.recall`                           |
| `friend_request`                                    | `request.friend`                                                         |
| `group_join_request` / `group_invited_join_request` | `request.group.add`                                                      |
| `group_invitation`                                  | `request.group.invite`                                                   |
| `friend_nudge` / `group_nudge`                      | `notice.friend.poke` / `notice.group.poke`                               |
| `group_member_increase` / `group_member_decrease`   | `notice.group.increase` / `notice.group.decrease`                        |
| `group_admin_change`                                | `notice.group.admin`                                                     |
| `group_mute` / `group_whole_mute`                   | `notice.group.ban` / `notice.group.whole_ban`                            |
| `group_message_reaction`                            | `notice.group.reaction`                                                  |
| `group_essence_message_change`                      | `notice.group.essence`                                                   |
| `group_name_change`                                 | `notice.group.name`                                                      |
| `group_disband`                                     | `notice.group.disband`                                                   |
| `group_file_upload` / `friend_file_upload`          | `notice.group.upload` / `notice.friend.offline_file`                     |
| `peer_pin_change`                                   | `notice.group.pin` / `notice.friend.pin`                                 |
| `bot_offline`                                       | `meta_event.lifecycle.offline`                                           |

每个路由也可以加上适配器前缀监听，如 `milky:message.group`。

## 平台扩展方法

通过 `ctx.pickBot<MilkyBot>(id)` 或 `bot.as<MilkyBot>()` 可以使用 Milky 特有的方法：

- `callApi(api, params)` / `sendApi(action, params)`：调用任意 Milky API
- `sendLike`、`pokeFriend`、`setReaction`、`setEssence`、`markAsRead`
- `uploadFile`、`getResourceUrl`、`getCookies`、`getCsrfToken`

## 许可证

MIT
