import {
  buildForwardSegment,
  decodeMessageId,
  encodeMessageId,
  fromMilkySegments,
  requireMessageRef,
  toMilkyMessage,
  toMilkyUri,
  toUin,
} from "./message";

import type {
  AdapterBotBase,
  BotBase,
  ForwardNode,
  ForwardSendNode,
  ForwardSendOptions,
  FriendInfo,
  GroupInfo,
  HistoryMessage,
  Logger,
  MemberInfo,
  MessageGetResult,
  MessageInput,
  MessageTarget,
  PlatformId,
  SentMessage,
} from "mioku";
import type { MilkyClient } from "./client";
import type {
  MilkyApiName,
  MilkyApiParams,
  MilkyApiResult,
  MilkyFriend,
  MilkyGroup,
  MilkyGroupMember,
  MilkyImplInfo,
  MilkyIncomingMessage,
  MilkyMessageScene,
  MilkyOutgoingSegment,
} from "./types";

export interface MilkyBotData {
  bot_id: string;
  readonly adapter: "milky";
  nickname: string;
  online: boolean;
  connected_at?: number;
  impl?: MilkyImplInfo;
}

export type MilkyBot = BotBase & {
  readonly adapter: "milky";
  readonly client: MilkyClient;
  readonly impl?: MilkyImplInfo;
  sendApi<T = unknown>(
    action: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  callApi<K extends MilkyApiName>(
    api: K,
    params: MilkyApiParams<K>,
  ): Promise<MilkyApiResult<K>>;
  sendLike(userId: PlatformId, times?: number): Promise<boolean>;
  pokeFriend(userId: PlatformId, isSelf?: boolean): Promise<void>;
  setReaction(
    messageId: PlatformId,
    reaction: string,
    isAdd?: boolean,
    type?: "face" | "emoji",
  ): Promise<void>;
  setEssence(messageId: PlatformId, isSet?: boolean): Promise<void>;
  markAsRead(messageId: PlatformId): Promise<void>;
  uploadFile(
    target: MessageTarget,
    file: string,
    name: string,
  ): Promise<string>;
  getResourceUrl(resourceId: string): Promise<string>;
  getCookies(domain: string): Promise<string>;
  getCsrfToken(): Promise<string>;
};

export type MilkyBotBase = AdapterBotBase<MilkyBot>;

declare module "mioku" {
  interface AdapterBotMap {
    milky: MilkyBot;
  }
}

interface Peer {
  readonly scene: MilkyMessageScene;
  readonly peer_id: number;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const peerOf = (target: MessageTarget): Peer => {
  if (target.type === "group")
    return {
      scene: "group",
      peer_id: toUin(target.group_id ?? target.id, "group_id"),
    };
  if (target.type === "private")
    return {
      scene: "friend",
      peer_id: toUin(target.user_id ?? target.id, "user_id"),
    };
  throw new Error(`不支持的消息目标类型: ${target.type}`);
};

export const toFriendInfo = (friend: MilkyFriend): FriendInfo => ({
  ...friend,
  user_id: String(friend.user_id),
});

export const toGroupInfo = (group: MilkyGroup): GroupInfo => ({
  ...group,
  group_id: String(group.group_id),
});

export const toMemberInfo = (member: MilkyGroupMember): MemberInfo => ({
  ...member,
  user_id: String(member.user_id),
  group_id: String(member.group_id),
});

const toHistoryMessage = (message: MilkyIncomingMessage): HistoryMessage => ({
  message_id: encodeMessageId({
    scene: message.message_scene,
    peer_id: message.peer_id,
    message_seq: message.message_seq,
  }),
  time: message.time * 1000,
  user_id: String(message.sender_id),
  nickname:
    message.message_scene === "group"
      ? message.group_member?.card || message.group_member?.nickname
      : message.message_scene === "friend"
        ? message.friend?.nickname
        : undefined,
  message: fromMilkySegments(message.segments),
});

export const createMilkyBot = (params: {
  data: MilkyBotData;
  client: MilkyClient;
  logger: Logger;
  onSend?: () => void;
}): MilkyBotBase => {
  const { data, client, logger, onSend } = params;

  const orNull = async <T>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await task();
    } catch (err) {
      logger.warn(`${label}失败: ${errorMessage(err)}`);
      return null;
    }
  };

  const sendSegments = async (
    peer: Peer,
    message: MilkyOutgoingSegment[],
  ): Promise<SentMessage> => {
    const result =
      peer.scene === "group"
        ? await client.call("send_group_message", {
            group_id: peer.peer_id,
            message,
          })
        : await client.call("send_private_message", {
            user_id: peer.peer_id,
            message,
          });
    onSend?.();
    return {
      message_id: encodeMessageId({ ...peer, message_seq: result.message_seq }),
      sent_at: result.time * 1000,
    };
  };

  const upload = async (
    peer: Peer,
    file_uri: string,
    file_name: string,
  ): Promise<string> => {
    const { file_id } =
      peer.scene === "group"
        ? await client.call("upload_group_file", {
            group_id: peer.peer_id,
            file_uri,
            file_name,
          })
        : await client.call("upload_private_file", {
            user_id: peer.peer_id,
            file_uri,
            file_name,
          });
    onSend?.();
    return file_id;
  };

  const groupMessageRef = (messageId: PlatformId) => {
    const ref = requireMessageRef(messageId);
    if (ref.scene !== "group") throw new Error("该操作仅支持群消息");
    return ref;
  };

  const bot = {
    get bot_id() {
      return data.bot_id;
    },
    adapter: data.adapter,
    get nickname() {
      return data.nickname;
    },
    get online() {
      return data.online;
    },
    get connected_at() {
      return data.connected_at;
    },
    get impl() {
      return data.impl;
    },
    client,
    async sendMessage(
      target: MessageTarget,
      message: MessageInput,
    ): Promise<SentMessage> {
      if (!data.online) throw new Error(`Bot ${data.bot_id} 未在线`);
      const peer = peerOf(target);
      const output = toMilkyMessage(message, Number(data.bot_id));
      if (output.dropped.length > 0)
        logger.warn(
          `Milky 不支持发送以下消息段，已忽略: ${[...new Set(output.dropped)].join(", ")}`,
        );
      if (output.segments.length === 0 && output.files.length === 0)
        throw new Error("消息内容为空或均不受支持");
      const sent =
        output.segments.length > 0
          ? await sendSegments(peer, output.segments)
          : {};
      for (const file of output.files) await upload(peer, file.uri, file.name);
      return sent;
    },
    async sendApi<T = unknown>(
      action: string,
      params: Record<string, unknown> = {},
    ): Promise<T> {
      return client.request<T>(action, params);
    },
    callApi<K extends MilkyApiName>(
      api: K,
      params: MilkyApiParams<K>,
    ): Promise<MilkyApiResult<K>> {
      return client.call(api, params);
    },
    async sendForward(
      target: MessageTarget,
      nodes: readonly ForwardSendNode[],
      options?: ForwardSendOptions,
    ): Promise<SentMessage> {
      if (!data.online) throw new Error(`Bot ${data.bot_id} 未在线`);
      return sendSegments(peerOf(target), [
        buildForwardSegment(nodes, Number(data.bot_id), options),
      ]);
    },
    async recallMessage(messageId: PlatformId): Promise<void> {
      const ref = requireMessageRef(messageId);
      if (ref.scene === "group")
        await client.call("recall_group_message", {
          group_id: ref.peer_id,
          message_seq: ref.message_seq,
        });
      else
        await client.call("recall_private_message", {
          user_id: ref.peer_id,
          message_seq: ref.message_seq,
        });
    },
    async getMessage(messageId: PlatformId): Promise<MessageGetResult | null> {
      const ref = decodeMessageId(messageId);
      if (!ref) return null;
      return orNull(`获取消息 ${String(messageId)} `, async () => {
        const { message } = await client.call("get_message", {
          message_scene: ref.scene,
          peer_id: ref.peer_id,
          message_seq: ref.message_seq,
        });
        const history = toHistoryMessage(message);
        return {
          ...history,
          raw_message: history.message.raw_message,
          sender: { user_id: history.user_id, nickname: history.nickname },
          raw: message,
        };
      });
    },
    async getForwardMessage(id: PlatformId): Promise<ForwardNode[]> {
      let forwardId = String(id);
      const ref = decodeMessageId(id);
      if (ref) {
        const { message } = await client.call("get_message", {
          message_scene: ref.scene,
          peer_id: ref.peer_id,
          message_seq: ref.message_seq,
        });
        const forward = message.segments.find(
          (item) => item.type === "forward",
        );
        if (forward?.type !== "forward") return [];
        forwardId = forward.data.forward_id;
      }
      const { messages } = await client.call("get_forwarded_messages", {
        forward_id: forwardId,
      });
      return messages.map((item) => ({
        nickname: item.sender_name,
        time: item.time * 1000,
        message: fromMilkySegments(item.segments),
      }));
    },
    async getFriendList(): Promise<FriendInfo[]> {
      const { friends } = await client.call("get_friend_list", {});
      return friends.map(toFriendInfo);
    },
    async getFriendInfo(userId: PlatformId): Promise<FriendInfo | null> {
      return orNull(`获取用户 ${String(userId)} 信息`, async () => {
        const user_id = toUin(userId, "user_id");
        try {
          const { friend } = await client.call("get_friend_info", { user_id });
          return toFriendInfo(friend);
        } catch {
          const profile = await client.call("get_user_profile", { user_id });
          return { ...profile, user_id: String(user_id) };
        }
      });
    },
    async getGroupList(): Promise<GroupInfo[]> {
      const { groups } = await client.call("get_group_list", {});
      return groups.map(toGroupInfo);
    },
    async getGroupInfo(groupId: PlatformId): Promise<GroupInfo | null> {
      return orNull(`获取群 ${String(groupId)} 信息`, async () => {
        const { group } = await client.call("get_group_info", {
          group_id: toUin(groupId, "group_id"),
        });
        return toGroupInfo(group);
      });
    },
    async getGroupMembers(groupId: PlatformId): Promise<MemberInfo[]> {
      const { members } = await client.call("get_group_member_list", {
        group_id: toUin(groupId, "group_id"),
      });
      return members.map(toMemberInfo);
    },
    async getMemberInfo(
      groupId: PlatformId,
      userId: PlatformId,
    ): Promise<MemberInfo | null> {
      return orNull(
        `获取群 ${String(groupId)} 成员 ${String(userId)} 信息`,
        async () => {
          const { member } = await client.call("get_group_member_info", {
            group_id: toUin(groupId, "group_id"),
            user_id: toUin(userId, "user_id"),
          });
          return toMemberInfo(member);
        },
      );
    },
    async getHistory(
      target: MessageTarget,
      before?: string,
      limit = 20,
    ): Promise<HistoryMessage[]> {
      const peer = peerOf(target);
      const beforeSeq =
        before == null
          ? undefined
          : (decodeMessageId(before)?.message_seq ??
            (/^\d+$/.test(before) ? Number(before) : undefined));
      if (beforeSeq === 0) return [];
      const { messages } = await client.call("get_history_messages", {
        message_scene: peer.scene,
        peer_id: peer.peer_id,
        start_message_seq: beforeSeq == null ? undefined : beforeSeq - 1,
        limit: Math.min(Math.max(Math.trunc(limit), 1), 30),
      });
      return messages.map(toHistoryMessage);
    },
    async sendLike(userId: PlatformId, times = 1): Promise<boolean> {
      try {
        await client.call("send_profile_like", {
          user_id: toUin(userId, "user_id"),
          count: times,
        });
        return true;
      } catch (err) {
        logger.warn(`点赞 ${String(userId)} 失败: ${errorMessage(err)}`);
        return false;
      }
    },
    async pokeFriend(userId: PlatformId, isSelf = false): Promise<void> {
      await client.call("send_friend_nudge", {
        user_id: toUin(userId, "user_id"),
        is_self: isSelf,
      });
    },
    async setReaction(
      messageId: PlatformId,
      reaction: string,
      isAdd = true,
      type: "face" | "emoji" = "face",
    ): Promise<void> {
      const ref = groupMessageRef(messageId);
      await client.call("send_group_message_reaction", {
        group_id: ref.peer_id,
        message_seq: ref.message_seq,
        reaction,
        reaction_type: type,
        is_add: isAdd,
      });
    },
    async setEssence(messageId: PlatformId, isSet = true): Promise<void> {
      const ref = groupMessageRef(messageId);
      await client.call("set_group_essence_message", {
        group_id: ref.peer_id,
        message_seq: ref.message_seq,
        is_set: isSet,
      });
    },
    async markAsRead(messageId: PlatformId): Promise<void> {
      const ref = requireMessageRef(messageId);
      await client.call("mark_message_as_read", {
        message_scene: ref.scene,
        peer_id: ref.peer_id,
        message_seq: ref.message_seq,
      });
    },
    async uploadFile(
      target: MessageTarget,
      file: string,
      name: string,
    ): Promise<string> {
      return upload(peerOf(target), toMilkyUri(file), name);
    },
    async getResourceUrl(resourceId: string): Promise<string> {
      const { url } = await client.call("get_resource_temp_url", {
        resource_id: resourceId,
      });
      return url;
    },
    async getCookies(domain: string): Promise<string> {
      const { cookies } = await client.call("get_cookies", { domain });
      return cookies;
    },
    async getCsrfToken(): Promise<string> {
      const { csrf_token } = await client.call("get_csrf_token", {});
      return csrf_token;
    },
    as<T extends object = Record<string, unknown>>(): T {
      return this as unknown as T;
    },
  } satisfies MilkyBotBase;
  return bot;
};
