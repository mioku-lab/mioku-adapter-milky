import {
  bindCapabilities,
  colors,
  defineAdapter,
  registerStatusProvider,
} from "mioku";
import { version as adapterVersion } from "../package.json" with { type: "json" };
import { createMilkyBot, type MilkyBot, type MilkyBotData } from "./bot";
import { registerMilkyCapabilities } from "./capabilities";
import { MilkyClient } from "./client";
import {
  buildBaseUrl,
  buildEventUrl,
  normalizeConfig,
  type MilkyAdapterConfig,
  type ResolvedMilkyInstance,
} from "./config";
import {
  buildMessageEvent,
  buildNoticeEvent,
  buildOfflineEvent,
  buildRequestEvent,
  noticeSpecOf,
} from "./event";
import { MilkyEventGateway } from "./gateway";
import { createMilkyStatusProvider, type MilkyTraffic } from "./status";

import type {
  Adapter,
  AdapterContext,
  AdapterFactoryOptions,
  Logger,
  MessageEvent,
} from "mioku";
import type { MilkyEvent } from "./types";

const NAME = "milky";

export const MILKY_PROTOCOL_VERSION = "1.3";

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const isMilkyEvent = (value: unknown): value is MilkyEvent => {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.event_type === "string" &&
    typeof event.time === "number" &&
    typeof event.self_id === "number" &&
    typeof event.data === "object" &&
    event.data !== null
  );
};

const logMessage = (logger: Logger, event: MessageEvent): void => {
  const name = event.sender?.card || event.sender?.nickname || "";
  const sender = `${name}(${event.user_id})`;
  if (event.message_type === "group")
    logger.info(
      `[群:${event.group_name ?? ""}(${event.group_id})] ${sender}: ${event.raw_message}`,
    );
  else logger.info(`[私:${sender}] ${event.raw_message}`);
};

const buildInstance = (
  instance: ResolvedMilkyInstance,
  index: number,
  logger: Logger,
): Adapter => {
  const label = `Bot${index + 1}`;
  const traffic: MilkyTraffic = { sent: 0, received: 0 };
  const data: MilkyBotData = {
    bot_id: "",
    adapter: NAME,
    nickname: "",
    online: false,
  };
  const url = buildEventUrl(instance);
  const displayUrl = buildEventUrl(instance, true);
  let context: AdapterContext | undefined;
  let client: MilkyClient | undefined;
  let gateway: MilkyEventGateway | undefined;
  let bot: MilkyBot | undefined;
  let disposers: Array<() => void> = [];
  let ready: Promise<void> | null = null;
  let stopped = false;

  const setOffline = async (reason: string): Promise<void> => {
    if (!bot || !data.online) return;
    data.online = false;
    try {
      await context?.emitLifecycle({ type: "bot:disconnected", bot, reason });
    } catch (err) {
      logger.warn(`派发 bot:disconnected 失败: ${errorMessage(err)}`);
    }
  };

  const teardownBot = async (reason: string): Promise<void> => {
    await setOffline(reason);
    for (const dispose of disposers.splice(0).reverse()) dispose();
    bot = undefined;
  };

  /** 注册全部成功才返回，中途失败会把已注册的部分收回去 */
  const registerBot = (
    ctx: AdapterContext,
    created: MilkyBot,
  ): Array<() => void> => {
    const next: Array<() => void> = [];
    try {
      next.push(ctx.registerBot(created).unregister);
      next.push(...registerMilkyCapabilities(ctx, created));
      next.push(
        registerStatusProvider(
          { adapter: NAME, bot_id: created.bot_id },
          createMilkyStatusProvider(created, traffic),
        ),
      );
    } catch (err) {
      for (const dispose of next.reverse()) dispose();
      throw new Error(
        `Bot ${created.bot_id} 注册失败，请检查 milky.instances 是否重复配置了同一账号: ${errorMessage(err)}`,
      );
    }
    return next;
  };

  const ensureBot = async (): Promise<void> => {
    if (!context || !client) return;
    const ctx = context;
    const [login, impl] = await Promise.all([
      client.call("get_login_info", {}),
      client.call("get_impl_info", {}).catch(() => undefined),
    ]);
    const botId = String(login.uin);
    if (bot && bot.bot_id !== botId) await teardownBot("登录账号已变更");
    // 登录途中被 stop()：不能再建号，否则会注册出一个没人回收的 bot
    if (stopped) return;
    data.bot_id = botId;
    data.nickname = login.nickname;
    data.impl = impl;
    if (!bot) {
      const created = bindCapabilities(
        createMilkyBot({
          data,
          client,
          logger,
          onSend: () => traffic.sent++,
        }),
        ctx.getCapabilityRegistry(),
      );
      disposers = registerBot(ctx, created);
      bot = created;
    }
    if (data.online) return;
    data.online = true;
    data.connected_at = Date.now();
    const implLabel = impl ? `${impl.impl_name}-v${impl.impl_version} ` : "";
    logger.info(
      `已连接到 ${colors.cyan(label)}: ${colors.green(`${implLabel}${login.nickname}(${botId})`)}`,
    );
    await ctx.emitLifecycle({ type: "bot:connected", bot });
  };

  /** 登录只进行一次，连接建立瞬间到达的事件排队等它，而不是被丢掉 */
  const ensureReady = (): Promise<void> => {
    ready ??= ensureBot().finally(() => {
      ready = null;
    });
    return ready;
  };

  const handleEvent = async (payload: unknown): Promise<void> => {
    if (!isMilkyEvent(payload)) {
      logger.debug("忽略无法识别的 Milky 事件推送");
      return;
    }
    if (!client || !context || stopped) return;
    const event = payload;
    if (event.event_type === "bot_offline") {
      if (!bot) return;
      logger.warn(`${label} 已下线: ${event.data.reason}`);
      await context.dispatch(buildOfflineEvent(bot, event));
      await setOffline(event.data.reason);
      return;
    }
    if (!bot || !data.online) {
      try {
        await ensureReady();
      } catch (err) {
        logger.debug(`登录未完成，暂不处理事件: ${errorMessage(err)}`);
        return;
      }
    }
    if (!bot || stopped) return;
    if (event.event_type === "message_receive") {
      if (instance.ignore_self && event.data.sender_id === event.self_id) return;
      traffic.received++;
      const messageEvent = buildMessageEvent(bot, event.data);
      logMessage(logger, messageEvent);
      await context.dispatch(messageEvent);
      return;
    }
    const request = buildRequestEvent(bot, client, event);
    if (request) {
      await context.dispatch(request);
      return;
    }
    const spec = noticeSpecOf(event, bot);
    if (spec) {
      await context.dispatch(buildNoticeEvent(bot, event, spec));
      return;
    }
    logger.debug(`忽略未支持的 Milky 事件: ${event.event_type}`);
  };

  return {
    name: `${NAME}.${index + 1}`,
    version: adapterVersion,
    async start(next: AdapterContext): Promise<void> {
      context = next;
      stopped = false;
      const driver = next.getDriver();
      client = new MilkyClient({
        baseUrl: buildBaseUrl(instance),
        http: driver.http,
        token: instance.token,
        timeout: instance.timeout,
      });
      gateway = new MilkyEventGateway(
        {
          name: `${NAME}.gateway.${index + 1}`,
          url,
          displayUrl,
          transport: instance.transport,
          token: instance.token,
          ws: driver.websocket,
          logger,
          reconnect: instance.reconnect,
          reconnectInterval: instance.reconnectInterval,
          maxReconnectAttempts: instance.maxReconnectAttempts,
          maxReconnectInterval: instance.maxReconnectInterval,
        },
        {
          onOpen: ensureReady,
          onEvent: handleEvent,
          onClose: setOffline,
        },
      );
      logger.info(
        `>>> 正在连接 ${colors.cyan(label)}: ${colors.green(displayUrl)}`,
      );
      next.registerGateway(gateway);
    },
    async stop(reason = "stop"): Promise<void> {
      stopped = true;
      await gateway?.stop(reason);
      await teardownBot(reason);
      gateway = undefined;
      client = undefined;
      context = undefined;
    },
  };
};

export const milkyAdapterDefinition = defineAdapter<MilkyAdapterConfig>({
  name: NAME,
  version: adapterVersion,
  apiVersion: 1,
  validateConfig: normalizeConfig,
  create: (options: AdapterFactoryOptions<MilkyAdapterConfig>): Adapter => {
    const instances = options.config.instances.map((instance, index) =>
      buildInstance(instance, index, options.logger),
    );
    return {
      name: NAME,
      version: adapterVersion,
      impl: { name: "Milky", version: MILKY_PROTOCOL_VERSION },
      async start(context: AdapterContext): Promise<void> {
        for (const instance of instances) await instance.start(context);
      },
      async stop(reason?: string): Promise<void> {
        for (const instance of [...instances].reverse())
          await instance.stop(reason);
      },
    };
  },
});
