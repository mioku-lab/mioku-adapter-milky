import type {
  AdapterGateway,
  Logger,
  WebSocketClient,
  WebSocketConnection,
} from "mioku";
import type { MilkyEventTransport } from "./config";

export interface MilkyGatewayOptions {
  readonly name: string;
  readonly url: string;
  /** 带掩码的地址，只用于日志 */
  readonly displayUrl: string;
  readonly transport: MilkyEventTransport;
  readonly token?: string;
  readonly ws: WebSocketClient;
  readonly logger: Logger;
  readonly reconnect: boolean;
  readonly reconnectInterval: number;
  readonly maxReconnectAttempts: number;
  readonly maxReconnectInterval: number;
}

export interface MilkyGatewayHandlers {
  onOpen(): Promise<void>;
  onEvent(payload: unknown): Promise<void>;
  onClose(reason: string): Promise<void>;
}

/** 与 driver 的 WebSocket 连接超时保持一致 */
const SSE_CONNECT_TIMEOUT_MS = 15_000;

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const redact = (text: string, raw: string, masked: string): string =>
  text
    .replaceAll(raw, masked)
    .replace(/access_token=[^&\s"']*/g, "access_token=***");

export class MilkyEventGateway implements AdapterGateway {
  readonly name: string;
  readonly #options: MilkyGatewayOptions;
  readonly #handlers: MilkyGatewayHandlers;
  readonly #decoder = new TextDecoder();
  #connection: WebSocketConnection | null = null;
  #sse: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #attempts = 0;
  #stopped = true;

  constructor(options: MilkyGatewayOptions, handlers: MilkyGatewayHandlers) {
    this.name = options.name;
    this.#options = options;
    this.#handlers = handlers;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    try {
      await this.#connect();
    } catch (err) {
      // 驱动抛出的错误文本里可能带着含 token 的连接地址，外抛前先掩码
      const message = this.#redact(errorMessage(err));
      if (this.#stopped) return;
      if (!this.#options.reconnect) throw new Error(message);
      this.#options.logger.warn(`连接事件推送失败: ${message}`);
      this.#scheduleReconnect();
    }
  }

  async stop(reason = "stop"): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#sse?.abort();
    this.#sse = null;
    const connection = this.#connection;
    this.#connection = null;
    if (connection) await connection.close(1000, reason);
  }

  async #connect(): Promise<void> {
    if (this.#options.transport === "sse") await this.#connectSse();
    else await this.#connectWebSocket();
    this.#attempts = 0;
  }

  async #connectWebSocket(): Promise<void> {
    const connection = await this.#options.ws.connect(this.#options.url);
    if (this.#stopped) {
      await connection.close(1000, "stopped");
      return;
    }
    this.#connection = connection;
    connection.onMessage((data) => {
      const text = typeof data === "string" ? data : this.#decoder.decode(data);
      this.#emit(parseJson(text));
    });
    connection.onError((err) => {
      this.#options.logger.warn(
        `事件推送连接异常: ${this.#redact(err.message)}`,
      );
    });
    connection.onClose(({ code, reason }) => {
      if (this.#connection !== connection) return;
      this.#connection = null;
      this.#lost(
        `事件推送连接已关闭 (code=${code}${reason ? `, reason=${reason}` : ""})`,
      );
    });
    try {
      await this.#handlers.onOpen();
    } catch (err) {
      this.#connection = null;
      await connection.close(1011, "init failed");
      throw err;
    }
  }

  async #connectSse(): Promise<void> {
    const controller = new AbortController();
    // 先挂上，stop() 在连接尚未建立时也能中止
    this.#sse = controller;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.#options.token)
      headers.Authorization = `Bearer ${this.#options.token}`;
    // Driver 的 HttpClient 会缓冲完整响应体，SSE 长连接只能直接用 fetch 读流
    const timer = setTimeout(
      () => controller.abort(new Error(`SSE 连接超时 ${SSE_CONNECT_TIMEOUT_MS}ms`)),
      SSE_CONNECT_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(this.#options.url, {
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      this.#sse = null;
      throw new Error(this.#redact(errorMessage(err)));
    } finally {
      clearTimeout(timer);
    }
    if (this.#stopped) {
      this.#sse = null;
      controller.abort();
      return;
    }
    if (!response.ok || !response.body) {
      this.#sse = null;
      controller.abort();
      throw new Error(`SSE 连接失败: HTTP ${response.status}`);
    }
    try {
      await this.#handlers.onOpen();
    } catch (err) {
      this.#sse = null;
      controller.abort();
      throw err;
    }
    void this.#readSse(response.body, controller);
  }

  async #readSse(
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: string[] = [];
    let reason = "SSE 连接已断开";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line === "") {
            if (data.length > 0) this.#emit(parseJson(data.join("\n")));
            data = [];
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5).replace(/^ /, ""));
          }
          index = buffer.indexOf("\n");
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      reason = `SSE 连接异常: ${errorMessage(err)}`;
    }
    if (this.#sse !== controller) return;
    this.#sse = null;
    this.#lost(reason);
  }

  #emit(payload: unknown): void {
    this.#handlers.onEvent(payload).catch((err: unknown) => {
      this.#options.logger.error(
        `处理 Milky 事件失败: ${this.#redact(errorMessage(err))}`,
      );
    });
  }

  /** 日志里出现连接地址时统一掩码，避免 access_token 落盘 */
  #redact(text: string): string {
    return redact(text, this.#options.url, this.#options.displayUrl);
  }

  #lost(reason: string): void {
    this.#options.logger.warn(this.#redact(reason));
    this.#handlers.onClose(reason).catch(() => undefined);
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    const {
      reconnect,
      reconnectInterval,
      maxReconnectAttempts,
      maxReconnectInterval,
      logger,
    } = this.#options;
    if (this.#stopped || !reconnect || this.#timer) return;
    if (this.#attempts >= maxReconnectAttempts) {
      logger.error(`已达到最大重连次数 ${maxReconnectAttempts}，停止重连`);
      return;
    }
    this.#attempts += 1;
    const delay = Math.min(
      reconnectInterval * 2 ** (this.#attempts - 1),
      maxReconnectInterval,
    );
    logger.info(`将在 ${delay}ms 后进行第 ${this.#attempts} 次重连`);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#stopped) return;
      this.#connect().catch((err: unknown) => {
        if (this.#stopped) return;
        logger.warn(`重连失败: ${this.#redact(errorMessage(err))}`);
        this.#scheduleReconnect();
      });
    }, delay);
  }
}
