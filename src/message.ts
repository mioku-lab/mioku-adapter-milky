import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessage, isMessage, MessageSegmentImpl } from "mioku";

import type {
  ForwardSendNode,
  ForwardSendOptions,
  Message,
  MessageInput,
  MessageSegment,
  PlatformId,
} from "mioku";
import type {
  MilkyIncomingSegment,
  MilkyMessageScene,
  MilkyOutgoingForwardedMessage,
  MilkyOutgoingSegment,
} from "./types";

export interface MilkyMessageRef {
  readonly scene: MilkyMessageScene;
  readonly peer_id: number;
  readonly message_seq: number;
}

export interface MilkyOutgoingFile {
  readonly uri: string;
  readonly name: string;
}

export interface MilkyOutgoingMessage {
  readonly segments: MilkyOutgoingSegment[];
  readonly files: MilkyOutgoingFile[];
  readonly dropped: string[];
}

const MESSAGE_ID_PATTERN = /^(friend|group|temp):(\d+):(\d+)$/;
const URI_PATTERN = /^(?:file|https?|base64):\/\//i;
const DIGITS = /^\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseUin = (value: unknown): number | undefined => {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && DIGITS.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

export const toUin = (value: unknown, field = "id"): number => {
  const id = parseUin(value);
  if (id == null) throw new Error(`无效的 ${field}: ${String(value)}`);
  return id;
};

export const encodeMessageId = (ref: MilkyMessageRef): string =>
  `${ref.scene}:${ref.peer_id}:${ref.message_seq}`;

export const decodeMessageId = (id: PlatformId): MilkyMessageRef | null => {
  const match = MESSAGE_ID_PATTERN.exec(String(id));
  if (!match) return null;
  return {
    scene: match[1] as MilkyMessageScene,
    peer_id: Number(match[2]),
    message_seq: Number(match[3]),
  };
};

export const requireMessageRef = (id: PlatformId): MilkyMessageRef => {
  const ref = decodeMessageId(id);
  if (!ref) throw new Error(`无法识别的消息 ID: ${String(id)}`);
  return ref;
};

export const toMilkyUri = (value: string): string =>
  !URI_PATTERN.test(value) && isAbsolute(value)
    ? pathToFileURL(value).href
    : value;

const unsupported = (type: string): string => `[不支持的消息段:${type}]`;

const textSegment = (text: string): MessageSegment =>
  new MessageSegmentImpl("text", { text });

const mediaSegment = (
  type: string,
  data: { resource_id: string; temp_url: string },
): MessageSegment => {
  const { resource_id, temp_url, ...rest } = data;
  return new MessageSegmentImpl(
    type,
    { ...rest, url: temp_url, resource_id },
    { id: resource_id, url: temp_url },
  );
};

const fromMilkySegment = (
  segment: MilkyIncomingSegment,
): MessageSegment | null => {
  switch (segment.type) {
    case "text":
      return textSegment(segment.data.text);
    case "mention": {
      const id = String(segment.data.user_id);
      return new MessageSegmentImpl("at", {
        qq: id,
        target: id,
        name: segment.data.name,
      });
    }
    case "mention_all":
      return new MessageSegmentImpl("at", { qq: "all", target: "all" });
    case "face":
      return new MessageSegmentImpl("face", {
        id: segment.data.face_id,
        is_large: segment.data.is_large === true,
      });
    case "reply":
      return null;
    case "image":
    case "record":
    case "video":
      return mediaSegment(segment.type, segment.data);
    case "file": {
      const { file_id, file_name, file_size, file_hash } = segment.data;
      return new MessageSegmentImpl(
        "file",
        { file_id, name: file_name, size: file_size, file_hash },
        { id: file_id, name: file_name, size: file_size },
      );
    }
    case "forward": {
      const { forward_id, ...rest } = segment.data;
      return new MessageSegmentImpl("forward", { ...rest, id: forward_id });
    }
    case "market_face":
      return new MessageSegmentImpl(
        "mface",
        { ...segment.data },
        { url: segment.data.url },
      );
    case "light_app":
      return new MessageSegmentImpl("json", {
        data: segment.data.json_payload,
        app_name: segment.data.app_name,
      });
    case "xml":
      return new MessageSegmentImpl("xml", {
        data: segment.data.xml_payload,
        service_id: segment.data.service_id,
      });
    case "markdown":
      return new MessageSegmentImpl("markdown", {
        content: segment.data.content,
      });
    default:
      return textSegment(unsupported((segment as { type: string }).type));
  }
};

const describe = (segment: MilkyIncomingSegment): string => {
  switch (segment.type) {
    case "text":
      return segment.data.text;
    case "mention":
      return `@${segment.data.name || segment.data.user_id}`;
    case "mention_all":
      return "@全体成员";
    case "face":
      return "[表情]";
    case "reply":
      return "";
    case "image":
      return (
        segment.data.summary ||
        (segment.data.sub_type === "sticker" ? "[动画表情]" : "[图片]")
      );
    case "record":
      return "[语音]";
    case "video":
      return "[视频]";
    case "file":
      return `[文件]${segment.data.file_name}`;
    case "forward":
      return "[聊天记录]";
    case "market_face":
      return segment.data.summary || "[表情]";
    case "light_app":
      return "[小程序]";
    case "xml":
      return "[XML卡片]";
    case "markdown":
      return segment.data.content;
    default:
      return unsupported((segment as { type: string }).type);
  }
};

export const sanitizeSegments = (value: unknown): MilkyIncomingSegment[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is MilkyIncomingSegment =>
          isRecord(item) &&
          typeof item.type === "string" &&
          isRecord(item.data),
      )
    : [];

export const fromMilkySegments = (value: unknown): Message => {
  const segments = sanitizeSegments(value);
  return createMessage(
    segments
      .map(fromMilkySegment)
      .filter((item): item is MessageSegment => item !== null),
    segments.map(describe).join(""),
  );
};

export const replySeqOf = (value: unknown): number | undefined => {
  const reply = sanitizeSegments(value).find((item) => item.type === "reply");
  return reply?.type === "reply" ? reply.data.message_seq : undefined;
};

const itemsOf = (input: MessageInput): readonly (string | MessageSegment)[] => {
  if (typeof input === "string") return [input];
  if (isMessage(input)) return Array.from(input);
  if (Array.isArray(input)) return input;
  return [input as MessageSegment];
};

const uriOf = (segment: MessageSegment): string | undefined => {
  const { data, attachment } = segment;
  const value = [
    data.file,
    data.url,
    data.uri,
    data.path,
    attachment?.url,
    attachment?.file,
  ].find((item): item is string => typeof item === "string" && item.length > 0);
  return value == null ? undefined : toMilkyUri(value);
};

const fileNameOf = (segment: MessageSegment, uri: string): string => {
  const name = segment.data.name ?? segment.attachment?.name;
  if (typeof name === "string" && name) return name;
  if (uri.startsWith("base64://")) return "file";
  const tail = uri.split(/[\\/]/).pop()?.split("?")[0] ?? "";
  try {
    return decodeURIComponent(tail) || "file";
  } catch {
    return tail || "file";
  }
};

const replySeqFrom = (
  data: Readonly<Record<string, unknown>>,
): number | undefined => {
  if (typeof data.message_seq === "number") return data.message_seq;
  const id = data.message_id ?? data.id;
  if (id == null) return undefined;
  const ref = decodeMessageId(String(id));
  if (ref) return ref.message_seq;
  return DIGITS.test(String(id)) ? Number(id) : undefined;
};

const nodeOf = (segment: MessageSegment): ForwardSendNode => ({
  user_id: (segment.data.user_id ?? "") as PlatformId,
  nickname: String(segment.data.nickname ?? ""),
  content: (segment.data.content ?? "") as MessageInput,
});

const convertSegment = (
  segment: MessageSegment,
  output: MilkyOutgoingMessage,
): void => {
  const { data } = segment;
  switch (segment.type) {
    case "text":
      if (typeof data.text === "string" && data.text)
        output.segments.push({ type: "text", data: { text: data.text } });
      return;
    case "at": {
      const target = data.qq ?? data.target ?? data.user_id;
      if (target === "all") {
        output.segments.push({ type: "mention_all", data: {} });
        return;
      }
      const user_id = parseUin(target);
      if (user_id == null) output.dropped.push("at");
      else output.segments.push({ type: "mention", data: { user_id } });
      return;
    }
    case "face":
      output.segments.push({
        type: "face",
        data: {
          face_id: String(data.id ?? data.face_id ?? ""),
          is_large: data.is_large === true,
        },
      });
      return;
    case "reply": {
      const message_seq = replySeqFrom(data);
      if (message_seq == null) output.dropped.push("reply");
      else output.segments.push({ type: "reply", data: { message_seq } });
      return;
    }
    case "image":
    case "record":
    case "video":
    case "file": {
      const uri = uriOf(segment);
      if (uri == null) output.dropped.push(segment.type);
      else if (segment.type === "file")
        output.files.push({ uri, name: fileNameOf(segment, uri) });
      else if (segment.type === "record")
        output.segments.push({ type: "record", data: { uri } });
      else if (segment.type === "video")
        output.segments.push({ type: "video", data: { uri } });
      else
        output.segments.push({
          type: "image",
          data: {
            uri,
            sub_type: data.sub_type === "sticker" ? "sticker" : "normal",
            ...(typeof data.summary === "string"
              ? { summary: data.summary }
              : {}),
          },
        });
      return;
    }
    case "json":
      output.segments.push({
        type: "light_app",
        data: {
          json_payload:
            typeof data.data === "string"
              ? data.data
              : JSON.stringify(data.data ?? {}),
        },
      });
      return;
    case "markdown":
      if (typeof data.content === "string" && data.content)
        output.segments.push({ type: "text", data: { text: data.content } });
      return;
    default:
      output.dropped.push(segment.type);
  }
};

export const toMilkyMessage = (
  input: MessageInput,
  selfId: number,
): MilkyOutgoingMessage => {
  const output: MilkyOutgoingMessage = { segments: [], files: [], dropped: [] };
  const nodes: ForwardSendNode[] = [];
  for (const item of itemsOf(input)) {
    if (typeof item === "string") {
      if (item) output.segments.push({ type: "text", data: { text: item } });
    } else if (item.type === "node") {
      nodes.push(nodeOf(item));
    } else {
      convertSegment(item, output);
    }
  }
  if (nodes.length > 0)
    output.segments.push(buildForwardSegment(nodes, selfId));
  return output;
};

export const buildForwardSegment = (
  nodes: readonly ForwardSendNode[],
  selfId: number,
  options: ForwardSendOptions = {},
): MilkyOutgoingSegment => {
  const messages: MilkyOutgoingForwardedMessage[] = nodes.map((node) => ({
    user_id: parseUin(node.user_id) ?? selfId,
    sender_name: node.nickname,
    segments: toMilkyMessage(node.content, selfId).segments,
  }));
  const preview = (options.news ?? [])
    .map((item) => item.text)
    .filter(Boolean)
    .slice(0, 4);
  return {
    type: "forward",
    data: {
      messages,
      ...(options.source ? { title: options.source } : {}),
      ...(preview.length > 0 ? { preview } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
    },
  };
};
