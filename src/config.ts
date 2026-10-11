export type MilkyEventTransport = "websocket" | "sse";

export interface MilkyInstanceConfig {
  protocol?: "http" | "https";
  host?: string;
  port?: number;
  prefix?: string;
  token?: string;
  transport?: MilkyEventTransport;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  maxReconnectInterval?: number;
  timeout?: number;
  ignore_self?: boolean;
}

export type ResolvedMilkyInstance = Required<
  Omit<MilkyInstanceConfig, "token">
> &
  Pick<MilkyInstanceConfig, "token">;

export interface MilkyAdapterConfig {
  instances: ReadonlyArray<ResolvedMilkyInstance>;
}

export const DEFAULT_INSTANCE: Readonly<Omit<ResolvedMilkyInstance, "token">> =
  {
    protocol: "http",
    host: "localhost",
    port: 3000,
    prefix: "",
    transport: "websocket",
    reconnect: true,
    reconnectInterval: 1000,
    maxReconnectAttempts: Infinity,
    maxReconnectInterval: 30_000,
    timeout: 30_000,
    ignore_self: true,
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectInstances = (input: unknown): unknown[] => {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) return [];
  if (Array.isArray(input.instances)) return input.instances;
  return "host" in input || "port" in input ? [input] : [];
};

const oneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
  field: string,
): T => {
  if (value == null) return fallback;
  if (
    typeof value === "string" &&
    (options as readonly string[]).includes(value)
  )
    return value as T;
  throw new Error(`${field} 只能是 ${options.join(" / ")}`);
};

const positive = (value: unknown, fallback: number, field: string): number => {
  if (value == null) return fallback;
  if (typeof value === "number" && value > 0) return value;
  throw new Error(`${field} 必须是正数`);
};

const flag = (value: unknown, fallback: boolean, field: string): boolean => {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  throw new Error(`${field} 必须是布尔值`);
};

const optionalText = (value: unknown, field: string): string | undefined => {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  throw new Error(`${field} 必须是字符串`);
};

const normalizePrefix = (value: string | undefined): string => {
  const trimmed = (value ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
};

export const resolveInstance = (
  raw: unknown,
  index: number,
): ResolvedMilkyInstance => {
  const at = (field: string): string => `milky.instances[${index}].${field}`;
  if (!isRecord(raw)) throw new Error(`milky.instances[${index}] 必须是对象`);
  const port = raw.port ?? DEFAULT_INSTANCE.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error(`${at("port")} 必须是 1-65535 之间的整数`);
  return {
    protocol: oneOf(
      raw.protocol,
      ["http", "https"],
      DEFAULT_INSTANCE.protocol,
      at("protocol"),
    ),
    host: optionalText(raw.host, at("host")) ?? DEFAULT_INSTANCE.host,
    port,
    prefix: normalizePrefix(optionalText(raw.prefix, at("prefix"))),
    token: optionalText(raw.token, at("token")),
    transport: oneOf(
      raw.transport,
      ["websocket", "sse"],
      DEFAULT_INSTANCE.transport,
      at("transport"),
    ),
    reconnect: flag(raw.reconnect, DEFAULT_INSTANCE.reconnect, at("reconnect")),
    reconnectInterval: positive(
      raw.reconnectInterval,
      DEFAULT_INSTANCE.reconnectInterval,
      at("reconnectInterval"),
    ),
    maxReconnectAttempts: positive(
      raw.maxReconnectAttempts,
      DEFAULT_INSTANCE.maxReconnectAttempts,
      at("maxReconnectAttempts"),
    ),
    maxReconnectInterval: positive(
      raw.maxReconnectInterval,
      DEFAULT_INSTANCE.maxReconnectInterval,
      at("maxReconnectInterval"),
    ),
    timeout: positive(raw.timeout, DEFAULT_INSTANCE.timeout, at("timeout")),
    ignore_self: flag(
      raw.ignore_self,
      DEFAULT_INSTANCE.ignore_self,
      at("ignore_self"),
    ),
  };
};

export const normalizeConfig = (input: unknown): MilkyAdapterConfig => {
  const instances = collectInstances(input).map(resolveInstance);
  if (instances.length === 0)
    throw new Error("milky.instances 至少需要配置一个实例");
  return { instances };
};

const formatHost = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

export const buildBaseUrl = (instance: ResolvedMilkyInstance): string =>
  `${instance.protocol}://${formatHost(instance.host)}:${instance.port}${instance.prefix}`;

export const buildEventUrl = (
  instance: ResolvedMilkyInstance,
  masked = false,
): string => {
  const base = buildBaseUrl(instance);
  if (instance.transport === "sse") return `${base}/event`;
  const url = `${base.replace(/^http/, "ws")}/event`;
  if (!instance.token) return url;
  return `${url}?access_token=${masked ? "***" : encodeURIComponent(instance.token)}`;
};
