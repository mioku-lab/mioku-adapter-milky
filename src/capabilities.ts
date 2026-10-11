import {
  avatarGet,
  avatarSet,
  botStatus,
  conversationGetHistory,
  forwardSend,
  friendDelete,
  friendGetInfo,
  friendGetList,
  groupGetInfo,
  groupGetList,
  groupGetMembers,
  groupLeave,
  groupSetName,
  groupSetPortrait,
  groupSetWholeBan,
  memberBan,
  memberGetInfo,
  memberKick,
  memberPoke,
  memberSetAdmin,
  memberSetCard,
  memberSetTitle,
  messageGet,
  messageGetForward,
  messageRecall,
  messageSend,
  profileSet,
} from "mioku";
import { toMilkyUri, toUin } from "./message";

import type { AdapterContext } from "mioku";
import type { MilkyBot } from "./bot";

const done = async (task: Promise<unknown>): Promise<void> => {
  await task;
};

const required = <T>(value: T | null, label: string): T => {
  if (value == null) throw new Error(`${label}不存在或获取失败`);
  return value;
};

export const registerMilkyCapabilities = (
  context: AdapterContext,
  bot: MilkyBot,
): Array<() => void> => {
  const target = { adapter: bot.adapter, bot_id: bot.bot_id };
  const { client } = bot;
  const member = (req: { group_id: unknown; user_id: unknown }) => ({
    group_id: toUin(req.group_id, "group_id"),
    user_id: toUin(req.user_id, "user_id"),
  });
  const group = (req: { group_id: unknown }) => ({
    group_id: toUin(req.group_id, "group_id"),
  });
  return [
    context.registerCapability(messageSend, target, (req) =>
      bot.sendMessage(req.target, req.message),
    ),
    context.registerCapability(messageRecall, target, (req) =>
      bot.recallMessage(req.message_id),
    ),
    context.registerCapability(messageGet, target, async (req) =>
      required(await bot.getMessage(req.message_id), "消息"),
    ),
    context.registerCapability(messageGetForward, target, (req) =>
      bot.getForwardMessage(req.message_id),
    ),
    context.registerCapability(forwardSend, target, (req) =>
      bot.sendForward(req.target, req.nodes, req),
    ),
    context.registerCapability(memberBan, target, (req) =>
      done(
        client.call("set_group_member_mute", {
          ...member(req),
          duration: req.duration,
        }),
      ),
    ),
    context.registerCapability(memberKick, target, (req) =>
      done(
        client.call("kick_group_member", {
          ...member(req),
          reject_add_request: req.reject_add_request ?? false,
        }),
      ),
    ),
    context.registerCapability(memberSetCard, target, (req) =>
      done(
        client.call("set_group_member_card", {
          ...member(req),
          card: req.card,
        }),
      ),
    ),
    context.registerCapability(memberSetAdmin, target, (req) =>
      done(
        client.call("set_group_member_admin", {
          ...member(req),
          is_set: req.enable,
        }),
      ),
    ),
    context.registerCapability(memberSetTitle, target, (req) =>
      done(
        client.call("set_group_member_special_title", {
          ...member(req),
          special_title: req.title,
        }),
      ),
    ),
    context.registerCapability(memberPoke, target, (req) =>
      done(client.call("send_group_nudge", member(req))),
    ),
    context.registerCapability(memberGetInfo, target, async (req) =>
      required(await bot.getMemberInfo(req.group_id, req.user_id), "群成员"),
    ),
    context.registerCapability(groupGetInfo, target, async (req) =>
      required(await bot.getGroupInfo(req.group_id), "群"),
    ),
    context.registerCapability(groupGetMembers, target, (req) =>
      bot.getGroupMembers(req.group_id),
    ),
    context.registerCapability(groupGetList, target, () => bot.getGroupList()),
    context.registerCapability(groupLeave, target, (req) =>
      done(client.call("quit_group", group(req))),
    ),
    context.registerCapability(groupSetName, target, (req) =>
      done(
        client.call("set_group_name", {
          ...group(req),
          new_group_name: req.group_name,
        }),
      ),
    ),
    context.registerCapability(groupSetPortrait, target, (req) =>
      done(
        client.call("set_group_avatar", {
          ...group(req),
          image_uri: toMilkyUri(req.file),
        }),
      ),
    ),
    context.registerCapability(groupSetWholeBan, target, (req) =>
      done(
        client.call("set_group_whole_mute", {
          ...group(req),
          is_mute: req.enable,
        }),
      ),
    ),
    context.registerCapability(friendGetInfo, target, async (req) =>
      required(await bot.getFriendInfo(req.user_id), "用户"),
    ),
    context.registerCapability(friendGetList, target, () =>
      bot.getFriendList(),
    ),
    context.registerCapability(friendDelete, target, (req) =>
      done(
        client.call("delete_friend", {
          user_id: toUin(req.user_id, "user_id"),
        }),
      ),
    ),
    context.registerCapability(conversationGetHistory, target, (req) =>
      bot.getHistory(
        req.target,
        req.before == null ? undefined : String(req.before),
        req.limit,
      ),
    ),
    context.registerCapability(profileSet, target, async (req) => {
      if (typeof req.nickname === "string")
        await client.call("set_nickname", { new_nickname: req.nickname });
      if (typeof req.personal_note === "string")
        await client.call("set_bio", { new_bio: req.personal_note });
    }),
    context.registerCapability(avatarSet, target, (req) =>
      done(client.call("set_avatar", { uri: toMilkyUri(req.file) })),
    ),
    context.registerCapability(
      avatarGet,
      target,
      async () =>
        `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(bot.bot_id)}&s=640`,
    ),
    context.registerCapability(botStatus, target, async () => ({
      online: bot.online,
      app_name: bot.impl?.impl_name,
      app_version: bot.impl?.impl_version,
      protocol_version: bot.impl?.milky_version,
      qq_protocol_type: bot.impl?.qq_protocol_type,
      qq_protocol_version: bot.impl?.qq_protocol_version,
    })),
  ];
};
