#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import consola from "consola";

import type { ConfirmPromptOptions, TextPromptOptions } from "consola";
import type { MilkyEventTransport, MilkyInstanceConfig } from "./config";

type ConfirmOpts = Omit<ConfirmPromptOptions, "type">;
type TextOpts = Omit<TextPromptOptions, "type">;

const confirm = async (
  message: string,
  options?: ConfirmOpts,
): Promise<boolean> =>
  (await consola.prompt(message, {
    type: "confirm",
    cancel: "reject",
    ...options,
  })) as boolean;

const input = async (message: string, options?: TextOpts): Promise<string> =>
  String(
    (await consola.prompt(message, {
      type: "text",
      cancel: "reject",
      ...options,
    })) ?? "",
  ).trim();

const select = <T extends string>(
  message: string,
  options: Array<{ label: string; value: T }>,
): Promise<T> =>
  consola.prompt(message, {
    type: "select",
    cancel: "reject",
    options,
  }) as Promise<T>;

export interface MilkyCliContext {
  readonly cwd: string;
  readonly logger?: typeof consola;
}

export interface MilkyCliConfig {
  instances: MilkyInstanceConfig[];
}

export const run = async (ctx: MilkyCliContext): Promise<MilkyCliConfig> => {
  const log = ctx.logger ?? consola;
  log.info("正在配置 milky 适配器连接参数");
  log.info("");

  const instances: MilkyInstanceConfig[] = [];
  let addMore = true;
  while (addMore) {
    const protocol = await select("协议端 HTTP 服务协议", [
      { label: "http (未加密)", value: "http" as const },
      { label: "https (加密)", value: "https" as const },
    ]);
    const host =
      (await input("协议端主机地址", {
        default: "localhost",
        placeholder: "localhost",
      })) || "localhost";
    const port =
      Number(
        await input("协议端 HTTP 服务端口", {
          default: "3000",
          placeholder: "3000",
        }),
      ) || 3000;
    const prefix = await input("路径前缀 (可空)", { placeholder: "可空" });
    const token = await input("访问令牌 access_token (可空)", {
      placeholder: "可空",
    });
    const transport = await select<MilkyEventTransport>("事件推送方式", [
      { label: "WebSocket", value: "websocket" },
      { label: "SSE", value: "sse" },
    ]);
    const reconnect = await confirm("断线自动重连？", { initial: true });

    instances.push({
      protocol,
      host,
      port,
      ...(prefix ? { prefix } : {}),
      ...(token ? { token } : {}),
      transport,
      reconnect,
    });
    addMore = await confirm("是否继续添加连接实例？", { initial: false });
    if (addMore) log.info("");
  }

  return { instances };
};

const isRunningAsMain = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
};

if (isRunningAsMain()) {
  void (async () => {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) {
      consola.error("未找到 package.json，请在机器人项目根目录运行此向导");
      process.exit(1);
    }
    const config = await run({ cwd });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      mioku?: Record<string, unknown>;
    };
    pkg.mioku = pkg.mioku ?? {};
    const adapters =
      (pkg.mioku.adapters as Record<string, unknown> | undefined) ?? {};
    pkg.mioku.adapters = { ...adapters, milky: config };
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    consola.success("已写入 milky 适配器配置");
  })();
}

export default run;
