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

import type { AdapterContext, Capability } from "mioku";
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
  const disposers: Array<() => void> = [];
  /** 中途失败要把已注册的收回去，否则重试会撞上重复注册 */
  const add = <I, O>(
    capability: Capability<I, O>,
    handler: (req: I) => Promise<O>,
  ): void => {
    disposers.push(context.registerCapability(capability, target, handler));
  };

  try {
    add(messageSend, (req) => bot.sendMessage(req.target, req.message));
    add(messageRecall, (req) => bot.recallMessage(req.message_id));
    add(messageGet, async (req) =>
      required(await bot.getMessage(req.message_id), "消息"),
    );
    add(messageGetForward, (req) => bot.getForwardMessage(req.message_id));
    add(forwardSend, (req) => bot.sendForward(req.target, req.nodes, req));
    add(memberBan, (req) =>
      done(
        client.call("set_group_member_mute", {
          ...member(req),
          duration: req.duration,
        }),
      ),
    );
    add(memberKick, (req) =>
      done(
        client.call("kick_group_member", {
          ...member(req),
          reject_add_request: req.reject_add_request ?? false,
        }),
      ),
    );
    add(memberSetCard, (req) =>
      done(
        client.call("set_group_member_card", {
          ...member(req),
          card: req.card,
        }),
      ),
    );
    add(memberSetAdmin, (req) =>
      done(
        client.call("set_group_member_admin", {
          ...member(req),
          is_set: req.enable,
        }),
      ),
    );
    add(memberSetTitle, (req) =>
      done(
        client.call("set_group_member_special_title", {
          ...member(req),
          special_title: req.title,
        }),
      ),
    );
    add(memberPoke, (req) => done(client.call("send_group_nudge", member(req))));
    add(memberGetInfo, async (req) =>
      required(await bot.getMemberInfo(req.group_id, req.user_id), "群成员"),
    );
    add(groupGetInfo, async (req) =>
      required(await bot.getGroupInfo(req.group_id), "群"),
    );
    add(groupGetMembers, (req) => bot.getGroupMembers(req.group_id));
    add(groupGetList, () => bot.getGroupList());
    add(groupLeave, (req) => done(client.call("quit_group", group(req))));
    add(groupSetName, (req) =>
      done(
        client.call("set_group_name", {
          ...group(req),
          new_group_name: req.group_name,
        }),
      ),
    );
    add(groupSetPortrait, (req) =>
      done(
        client.call("set_group_avatar", {
          ...group(req),
          image_uri: toMilkyUri(req.file),
        }),
      ),
    );
    add(groupSetWholeBan, (req) =>
      done(
        client.call("set_group_whole_mute", {
          ...group(req),
          is_mute: req.enable,
        }),
      ),
    );
    add(friendGetInfo, async (req) =>
      required(await bot.getFriendInfo(req.user_id), "用户"),
    );
    add(friendGetList, () => bot.getFriendList());
    add(friendDelete, (req) =>
      done(
        client.call("delete_friend", {
          user_id: toUin(req.user_id, "user_id"),
        }),
      ),
    );
    add(conversationGetHistory, (req) =>
      bot.getHistory(
        req.target,
        req.before == null ? undefined : String(req.before),
        req.limit,
      ),
    );
    add(profileSet, async (req) => {
      if (typeof req.nickname === "string")
        await client.call("set_nickname", { new_nickname: req.nickname });
      if (typeof req.personal_note === "string")
        await client.call("set_bio", { new_bio: req.personal_note });
    });
    add(avatarSet, (req) =>
      done(client.call("set_avatar", { uri: toMilkyUri(req.file) })),
    );
    // Milky 1.3 没有获取头像的 API，Milky 账号即 QQ 号，走 QQ 号头像服务
    add(
      avatarGet,
      async () =>
        `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(bot.bot_id)}&s=640`,
    );
    add(botStatus, async () => ({
      online: bot.online,
      app_name: bot.impl?.impl_name,
      app_version: bot.impl?.impl_version,
      protocol_version: bot.impl?.milky_version,
      qq_protocol_type: bot.impl?.qq_protocol_type,
      qq_protocol_version: bot.impl?.qq_protocol_version,
    }));
  } catch (err) {
    for (const dispose of disposers.reverse()) dispose();
    throw err;
  }
  return disposers;
};
