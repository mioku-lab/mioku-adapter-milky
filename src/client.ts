import type { HttpClient, HttpResponse } from "mioku";
import type { MilkyApiName, MilkyApiParams, MilkyApiResult } from "./types";

const HTTP_ERRORS: Readonly<Record<number, string>> = {
  401: "鉴权失败，请检查 access_token",
  404: "API 不存在",
  415: "Content-Type 不受支持",
};

export class MilkyApiError extends Error {
  readonly api: string;
  readonly retcode: number;
  readonly status: number;

  constructor(api: string, message: string, retcode = -1, status = 200) {
    super(`${api}: ${message} (retcode=${retcode})`);
    this.name = "MilkyApiError";
    this.api = api;
    this.retcode = retcode;
    this.status = status;
  }
}

export interface MilkyClientOptions {
  readonly baseUrl: string;
  readonly http: HttpClient;
  readonly token?: string;
  readonly timeout?: number;
}

interface MilkyResponse {
  readonly status?: string;
  readonly retcode?: number;
  readonly data?: unknown;
  readonly message?: string;
}

export class MilkyClient {
  readonly #options: MilkyClientOptions;

  constructor(options: MilkyClientOptions) {
    this.#options = options;
  }

  call<K extends MilkyApiName>(
    api: K,
    params: MilkyApiParams<K>,
  ): Promise<MilkyApiResult<K>> {
    return this.request<MilkyApiResult<K>>(api, params);
  }

  async request<T = unknown>(
    api: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    const { baseUrl, http, token, timeout } = this.#options;
    let response: HttpResponse;
    try {
      response = await http.request({
        method: "POST",
        url: `${baseUrl}/api/${api}`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: params,
        timeout,
      });
    } catch (err) {
      throw new MilkyApiError(
        api,
        err instanceof Error ? err.message : String(err),
        -1,
        0,
      );
    }
    if (response.status !== 200)
      throw new MilkyApiError(
        api,
        HTTP_ERRORS[response.status] ?? `HTTP ${response.status}`,
        -1,
        response.status,
      );
    let payload: MilkyResponse;
    try {
      payload = response.json<MilkyResponse>();
    } catch {
      throw new MilkyApiError(api, "响应不是合法的 JSON");
    }
    if (payload.status !== "ok" || payload.retcode !== 0)
      throw new MilkyApiError(
        api,
        payload.message ?? "调用失败",
        payload.retcode ?? -1,
      );
    return (payload.data ?? {}) as T;
  }
}
