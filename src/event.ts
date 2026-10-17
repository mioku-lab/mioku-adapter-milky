import {
  asMessage,
  atOf,
  buildRoutes,
  createFriendRef,
  createGroupRef,
  segment,
} from "mioku";
import { encodeMessageId, fromMilkySegments, replySeqOf } from "./message";

import type {
  Bot,
  EventIdentity,
  Message,
  MessageEvent,
  MetaEvent,
  NoticeEvent,
  RequestEvent,
  SenderInfo,
} from "mioku";
import type { MilkyClient } from "./client";
import type { MilkyEvent, MilkyEventOf, MilkyIncomingMessage } from "./types";

export interface MilkyNoticeSpec {
  readonly notice_type: "friend" | "group";
  readonly sub_type: string;
  readonly user_id?: number | null;
  readonly group_id?: number | null;
  readonly operator_id?: number | null;
  readonly extra?: Readonly<Record<string, unknown>>;
}

interface RequestSpec {
  readonly request_type: "friend" | "group";
  readonly sub_type?: string;
  readonly user_id: number;
  readonly group_id?: number;
  readonly comment?: string;
  readonly flag: string;
  readonly extra?: Readonly<Record<string, unknown>>;
  approve(): Promise<unknown>;
  reject(reason?: string): Promise<unknown>;
}

const idOf = (value: number | null | undefined): string | undefined =>
  value ? String(value) : undefined;

const identityOf = (
  bot: Bot,
  eventType: string,
  time: number,
  extra: Pick<EventIdentity, "message_id" | "native_event_id"> = {},
): EventIdentity => ({
  adapter: bot.adapter,
  bot_id: bot.bot_id,
  event_type: eventType,
  timestamp: time * 1000,
  ...extra,
});

const senderOf = (data: MilkyIncomingMessage): SenderInfo => {
  const user_id = String(data.sender_id);
  if (data.message_scene === "group")
    return {
      user_id,
      nickname: data.group_member?.nickname,
      card: data.group_member?.card || undefined,
      role: data.group_member?.role,
    };
  if (data.message_scene === "friend")
    return { user_id, nickname: data.friend?.nickname };
  return { user_id };
};

const mentions = (message: Message, selfId: string): boolean =>
  message.some((item) => item.type === "at" && item.data.qq === selfId);

export const buildMessageEvent = (
  bot: Bot,
  data: MilkyIncomingMessage,
): MessageEvent => {
  const scene = data.message_scene;
  const isGroup = scene === "group";
  const isTemp = scene === "temp";
  const peer = { scene, peer_id: data.peer_id };
  const userId = String(data.sender_id);
  // 临时会话按 OneBot 习惯带来源群号，sub_type 也用 group
  const groupId = isGroup
    ? String(data.peer_id)
    : isTemp
      ? idOf(data.group?.group_id ?? null)
      : undefined;
  const groupName =
    scene === "group" || scene === "temp" ? data.group?.group_name : undefined;
  const messageId = encodeMessageId({ ...peer, message_seq: data.message_seq });
  const quoteSeq = replySeqOf(data.segments);
  const message = fromMilkySegments(data.segments);
  const sender = senderOf(data);
  const subType = isGroup ? undefined : isTemp ? "group" : "friend";
  const target = isGroup
    ? { type: "group", group_id: groupId }
    : { type: "private", user_id: userId };
  return {
    kind: "message",
    type: "message",
    routes: buildRoutes(
      bot.adapter,
      "message",
      isGroup ? "group" : "private",
      subType,
    ),
    identity: identityOf(
      bot,
      isGroup ? "message.group" : "message.private",
      data.time,
      { message_id: messageId },
    ),
    self_id: bot.bot_id,
    bot,
    time: data.time * 1000,
    raw: data,
    message_type: isGroup ? "group" : "private",
    sub_type: subType,
    user_id: userId,
    group_id: groupId,
    group_name: groupName,
    message_id: messageId,
    raw_message: message.raw_message,
    quote_id:
      quoteSeq == null
        ? undefined
        : encodeMessageId({ ...peer, message_seq: quoteSeq }),
    sender,
    group: groupId ? createGroupRef(bot, groupId, groupName) : undefined,
    friend: isGroup ? undefined : createFriendRef(bot, userId, sender.nickname),
    message,
    is_to_me: !isGroup || mentions(message, bot.bot_id),
    at: atOf(message),
    reply: (input, options) => {
      const quote = typeof options === "boolean" ? options : options?.quote;
      return bot.sendMessage(
        target,
        quote ? [segment.reply(messageId), ...asMessage(input)] : input,
      );
    },
    recall: () => bot.recallMessage(messageId),
  };
};

export const noticeSpecOf = (
  event: MilkyEvent,
  bot: Bot,
): MilkyNoticeSpec | null => {
  const selfId = Number(bot.bot_id);
  switch (event.event_type) {
    case "message_recall": {
      const d = event.data;
      const isGroup = d.message_scene === "group";
      return {
        notice_type: isGroup ? "group" : "friend",
        sub_type: "recall",
        user_id: d.sender_id,
        group_id: isGroup ? d.peer_id : undefined,
        operator_id: d.operator_id,
        extra: {
          message_id: encodeMessageId({
            scene: d.message_scene,
            peer_id: d.peer_id,
            message_seq: d.message_seq,
          }),
          display_suffix: d.display_suffix,
        },
      };
    }
    case "peer_pin_change": {
      const d = event.data;
      const isGroup = d.message_scene === "group";
      return {
        notice_type: isGroup ? "group" : "friend",
        sub_type: "pin",
        user_id: isGroup ? undefined : d.peer_id,
        group_id: isGroup ? d.peer_id : undefined,
        extra: { is_pinned: d.is_pinned },
      };
    }
    case "friend_nudge": {
      const d = event.data;
      // OneBot poke：user_id 是发起者，target_id 是被戳者
      return {
        notice_type: "friend",
        sub_type: "poke",
        user_id: d.is_self_send ? selfId : d.user_id,
        extra: {
          target_id: String(d.is_self_receive ? selfId : d.user_id),
          self_send: d.is_self_send,
          self_receive: d.is_self_receive,
          action: d.display_action,
          suffix: d.display_suffix,
          action_img_url: d.display_action_img_url,
        },
      };
    }
    case "friend_file_upload": {
      const d = event.data;
      return {
        notice_type: "friend",
        sub_type: "offline_file",
        user_id: d.user_id,
        extra: {
          file: {
            id: d.file_id,
            name: d.file_name,
            size: d.file_size,
            hash: d.file_hash,
          },
          is_self: d.is_self,
        },
      };
    }
    case "group_admin_change": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "admin",
        user_id: d.user_id,
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: { action_type: d.is_set ? "set" : "unset" },
      };
    }
    case "group_essence_message_change": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "essence",
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: {
          action_type: d.is_set ? "add" : "delete",
          message_id: encodeMessageId({
            scene: "group",
            peer_id: d.group_id,
            message_seq: d.message_seq,
          }),
        },
      };
    }
    case "group_member_increase": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "increase",
        user_id: d.user_id,
        group_id: d.group_id,
        operator_id: d.operator_id || d.invitor_id,
        extra: {
          action_type: d.invitor_id ? "invite" : "approve",
          invitor_id: idOf(d.invitor_id),
        },
      };
    }
    case "group_member_decrease": {
      const d = event.data;
      const kicked = Boolean(d.operator_id);
      return {
        notice_type: "group",
        sub_type: "decrease",
        user_id: d.user_id,
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: {
          action_type: !kicked
            ? "leave"
            : d.user_id === selfId
              ? "kick_me"
              : "kick",
        },
      };
    }
    case "group_disband": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "disband",
        group_id: d.group_id,
        operator_id: d.operator_id,
      };
    }
    case "group_name_change": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "name",
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: { group_name: d.new_group_name },
      };
    }
    case "group_message_reaction": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "reaction",
        user_id: d.user_id,
        group_id: d.group_id,
        extra: {
          action_type: d.is_add ? "add" : "remove",
          message_id: encodeMessageId({
            scene: "group",
            peer_id: d.group_id,
            message_seq: d.message_seq,
          }),
          face_id: d.face_id,
          reaction_type: d.reaction_type ?? "face",
        },
      };
    }
    case "group_mute": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "ban",
        user_id: d.user_id,
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: {
          action_type: d.duration > 0 ? "ban" : "lift_ban",
          duration: d.duration,
        },
      };
    }
    case "group_whole_mute": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "whole_ban",
        group_id: d.group_id,
        operator_id: d.operator_id,
        extra: { action_type: d.is_mute ? "ban" : "lift_ban" },
      };
    }
    case "group_nudge": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "poke",
        user_id: d.sender_id,
        group_id: d.group_id,
        extra: {
          target_id: String(d.receiver_id),
          action: d.display_action,
          suffix: d.display_suffix,
          action_img_url: d.display_action_img_url,
        },
      };
    }
    case "group_file_upload": {
      const d = event.data;
      return {
        notice_type: "group",
        sub_type: "upload",
        user_id: d.user_id,
        group_id: d.group_id,
        extra: {
          file: { id: d.file_id, name: d.file_name, size: d.file_size },
        },
      };
    }
    default:
      return null;
  }
};

export const buildNoticeEvent = (
  bot: Bot,
  event: MilkyEvent,
  spec: MilkyNoticeSpec,
): NoticeEvent => ({
  ...spec.extra,
  kind: "notice",
  type: "notice",
  routes: buildRoutes(bot.adapter, "notice", spec.notice_type, spec.sub_type),
  identity: identityOf(bot, `notice.${spec.notice_type}`, event.time),
  self_id: bot.bot_id,
  bot,
  time: event.time * 1000,
  raw: event,
  notice_type: spec.notice_type,
  sub_type: spec.sub_type,
  user_id: idOf(spec.user_id),
  group_id: idOf(spec.group_id),
  operator_id: idOf(spec.operator_id),
});

const requestEvent = (
  bot: Bot,
  event: MilkyEvent,
  spec: RequestSpec,
): RequestEvent => ({
  ...spec.extra,
  kind: "request",
  type: "request",
  routes: buildRoutes(bot.adapter, "request", spec.request_type, spec.sub_type),
  identity: identityOf(bot, `request.${spec.request_type}`, event.time, {
    native_event_id: spec.flag,
  }),
  self_id: bot.bot_id,
  bot,
  time: event.time * 1000,
  raw: event,
  request_type: spec.request_type,
  sub_type: spec.sub_type,
  user_id: String(spec.user_id),
  group_id: idOf(spec.group_id),
  flag: spec.flag,
  comment: spec.comment,
  approve: async () => {
    await spec.approve();
  },
  reject: async (reason) => {
    await spec.reject(reason);
  },
});

export const buildRequestEvent = (
  bot: Bot,
  client: MilkyClient,
  event: MilkyEvent,
): RequestEvent | null => {
  switch (event.event_type) {
    case "friend_request": {
      const d = event.data;
      return requestEvent(bot, event, {
        request_type: "friend",
        user_id: d.initiator_id,
        comment: d.comment,
        flag: d.initiator_uid,
        extra: { via: d.via },
        approve: () =>
          client.call("accept_friend_request", {
            initiator_uid: d.initiator_uid,
          }),
        reject: (reason) =>
          client.call("reject_friend_request", {
            initiator_uid: d.initiator_uid,
            reason,
          }),
      });
    }
    case "group_join_request": {
      const d = event.data;
      const params = {
        notification_seq: d.notification_seq,
        notification_type: "join_request" as const,
        group_id: d.group_id,
        is_filtered: d.is_filtered,
      };
      return requestEvent(bot, event, {
        request_type: "group",
        sub_type: "add",
        user_id: d.initiator_id,
        group_id: d.group_id,
        comment: d.comment,
        flag: `${d.group_id}:${d.notification_seq}`,
        extra: { is_filtered: d.is_filtered },
        approve: () => client.call("accept_group_request", params),
        reject: (reason) =>
          client.call("reject_group_request", { ...params, reason }),
      });
    }
    case "group_invited_join_request": {
      const d = event.data;
      const params = {
        notification_seq: d.notification_seq,
        notification_type: "invited_join_request" as const,
        group_id: d.group_id,
      };
      return requestEvent(bot, event, {
        request_type: "group",
        sub_type: "add",
        user_id: d.target_user_id,
        group_id: d.group_id,
        flag: `${d.group_id}:${d.notification_seq}`,
        extra: { invitor_id: String(d.initiator_id) },
        approve: () => client.call("accept_group_request", params),
        reject: (reason) =>
          client.call("reject_group_request", { ...params, reason }),
      });
    }
    case "group_invitation": {
      const d = event.data;
      const params = { group_id: d.group_id, invitation_seq: d.invitation_seq };
      return requestEvent(bot, event, {
        request_type: "group",
        sub_type: "invite",
        user_id: d.initiator_id,
        group_id: d.group_id,
        flag: `${d.group_id}:${d.invitation_seq}`,
        extra: { source_group_id: idOf(d.source_group_id) },
        approve: () => client.call("accept_group_invitation", params),
        reject: () => client.call("reject_group_invitation", params),
      });
    }
    default:
      return null;
  }
};

export const buildOfflineEvent = (
  bot: Bot,
  event: MilkyEventOf<"bot_offline">,
): MetaEvent => ({
  kind: "meta_event",
  type: "meta_event",
  routes: buildRoutes(bot.adapter, "meta_event", "lifecycle", "offline"),
  identity: identityOf(bot, "meta_event.lifecycle", event.time),
  self_id: bot.bot_id,
  bot,
  time: event.time * 1000,
  raw: event,
  meta_event_type: "lifecycle",
  sub_type: "offline",
});
