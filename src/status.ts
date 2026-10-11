import type { AdapterStatus } from "mioku";
import type { MilkyBot } from "./bot";

export interface MilkyTraffic {
  sent: number;
  received: number;
}

export const createMilkyStatusProvider =
  (bot: MilkyBot, traffic: MilkyTraffic) =>
  async (): Promise<AdapterStatus> => {
    const { impl } = bot;
    const base = {
      adapter: bot.adapter,
      bot_id: bot.bot_id,
      impl: impl?.impl_name,
      version: impl?.impl_version,
      protocol: impl ? `milky/${impl.milky_version}` : undefined,
      platform: impl?.qq_protocol_type,
      platform_version: impl?.qq_protocol_version,
      data: { ...impl },
    };
    const counters = { sent: traffic.sent, received: traffic.received };
    try {
      const [friends, groups] = await Promise.all([
        bot.getFriendList(),
        bot.getGroupList(),
      ]);
      return {
        ...base,
        stats: { ...counters, friends: friends.length, groups: groups.length },
      };
    } catch {
      return { ...base, stats: counters };
    }
  };
