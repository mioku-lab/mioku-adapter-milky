export type MilkyMessageScene = "friend" | "group" | "temp";

export type MilkySex = "male" | "female" | "unknown";

export type MilkyGroupRole = "owner" | "admin" | "member";

export interface MilkyFriendCategory {
  category_id: number;
  category_name: string;
}

export interface MilkyFriend {
  user_id: number;
  nickname: string;
  sex: MilkySex;
  qid: string;
  remark: string;
  category: MilkyFriendCategory;
}

export interface MilkyGroup {
  group_id: number;
  group_name: string;
  member_count: number;
  max_member_count: number;
  remark?: string;
  created_time?: number;
  description?: string;
  question?: string;
  announcement?: string;
}

export interface MilkyGroupMember {
  user_id: number;
  nickname: string;
  sex: MilkySex;
  group_id: number;
  card: string;
  title: string;
  level: number;
  role: MilkyGroupRole;
  join_time: number;
  last_sent_time: number;
  shut_up_end_time?: number | null;
}

export interface MilkyUserProfile {
  nickname: string;
  qid: string;
  age: number;
  sex: MilkySex;
  remark: string;
  bio: string;
  level: number;
  country: string;
  city: string;
  school: string;
}

export interface MilkyIncomingSegmentDataMap {
  text: { text: string };
  mention: { user_id: number; name?: string };
  mention_all: Record<string, never>;
  face: { face_id: string; is_large?: boolean };
  reply: {
    message_seq: number;
    sender_id?: number;
    sender_name?: string | null;
    time?: number;
    segments?: MilkyIncomingSegment[];
  };
  image: {
    resource_id: string;
    temp_url: string;
    width?: number;
    height?: number;
    summary?: string;
    sub_type?: "normal" | "sticker";
  };
  record: { resource_id: string; temp_url: string; duration: number };
  video: {
    resource_id: string;
    temp_url: string;
    width?: number;
    height?: number;
    duration: number;
  };
  file: {
    file_id: string;
    file_name: string;
    file_size: number;
    file_hash?: string | null;
  };
  forward: {
    forward_id: string;
    title?: string;
    preview?: string[];
    summary?: string;
  };
  market_face: {
    emoji_package_id?: number;
    emoji_id?: string;
    key?: string;
    summary?: string;
    url: string;
  };
  light_app: { app_name: string; json_payload: string };
  xml: { service_id: number; xml_payload: string };
  markdown: { content: string };
}

export type MilkyIncomingSegmentType = keyof MilkyIncomingSegmentDataMap;

export type MilkyIncomingSegment = {
  [K in MilkyIncomingSegmentType]: {
    type: K;
    data: MilkyIncomingSegmentDataMap[K];
  };
}[MilkyIncomingSegmentType];

export interface MilkyOutgoingSegmentDataMap {
  text: { text: string };
  mention: { user_id: number };
  mention_all: Record<string, never>;
  face: { face_id: string; is_large?: boolean };
  reply: { message_seq: number };
  image: { uri: string; sub_type?: "normal" | "sticker"; summary?: string };
  record: { uri: string };
  video: { uri: string; thumb_uri?: string };
  forward: {
    messages: MilkyOutgoingForwardedMessage[];
    title?: string;
    preview?: string[];
    summary?: string;
    prompt?: string;
  };
  light_app: { json_payload: string };
}

export type MilkyOutgoingSegmentType = keyof MilkyOutgoingSegmentDataMap;

export type MilkyOutgoingSegment = {
  [K in MilkyOutgoingSegmentType]: {
    type: K;
    data: MilkyOutgoingSegmentDataMap[K];
  };
}[MilkyOutgoingSegmentType];

export interface MilkyOutgoingForwardedMessage {
  user_id: number;
  sender_name: string;
  segments: MilkyOutgoingSegment[];
  time?: number;
}

interface MilkyIncomingMessageBase {
  peer_id: number;
  message_seq: number;
  sender_id: number;
  time: number;
  segments: MilkyIncomingSegment[];
}

export interface MilkyIncomingFriendMessage extends MilkyIncomingMessageBase {
  message_scene: "friend";
  friend: MilkyFriend;
}

export interface MilkyIncomingGroupMessage extends MilkyIncomingMessageBase {
  message_scene: "group";
  group: MilkyGroup;
  group_member: MilkyGroupMember;
}

export interface MilkyIncomingTempMessage extends MilkyIncomingMessageBase {
  message_scene: "temp";
  group?: MilkyGroup | null;
}

export type MilkyIncomingMessage =
  | MilkyIncomingFriendMessage
  | MilkyIncomingGroupMessage
  | MilkyIncomingTempMessage;

export interface MilkyIncomingForwardedMessage {
  message_seq?: number;
  sender_name: string;
  avatar_url: string;
  time: number;
  segments: MilkyIncomingSegment[];
}

export interface MilkyEventDataMap {
  bot_offline: { reason: string };
  message_receive: MilkyIncomingMessage;
  message_recall: {
    message_scene: MilkyMessageScene;
    peer_id: number;
    message_seq: number;
    sender_id: number;
    operator_id: number;
    display_suffix: string;
  };
  peer_pin_change: {
    message_scene: MilkyMessageScene;
    peer_id: number;
    is_pinned: boolean;
  };
  friend_request: {
    initiator_id: number;
    initiator_uid: string;
    comment: string;
    via: string;
  };
  group_join_request: {
    group_id: number;
    notification_seq: number;
    is_filtered: boolean;
    initiator_id: number;
    comment: string;
  };
  group_invited_join_request: {
    group_id: number;
    notification_seq: number;
    initiator_id: number;
    target_user_id: number;
  };
  group_invitation: {
    group_id: number;
    invitation_seq: number;
    initiator_id: number;
    source_group_id?: number | null;
  };
  friend_nudge: {
    user_id: number;
    is_self_send: boolean;
    is_self_receive: boolean;
    display_action: string;
    display_suffix: string;
    display_action_img_url: string;
  };
  friend_file_upload: {
    user_id: number;
    file_id: string;
    file_name: string;
    file_size: number;
    file_hash: string;
    is_self: boolean;
  };
  group_admin_change: {
    group_id: number;
    user_id: number;
    operator_id: number;
    is_set: boolean;
  };
  group_essence_message_change: {
    group_id: number;
    message_seq: number;
    operator_id: number;
    is_set: boolean;
  };
  group_member_increase: {
    group_id: number;
    user_id: number;
    operator_id?: number | null;
    invitor_id?: number | null;
  };
  group_member_decrease: {
    group_id: number;
    user_id: number;
    operator_id?: number | null;
  };
  group_disband: { group_id: number; operator_id: number };
  group_name_change: {
    group_id: number;
    new_group_name: string;
    operator_id: number;
  };
  group_message_reaction: {
    group_id: number;
    user_id: number;
    message_seq: number;
    face_id: string;
    reaction_type?: "face" | "emoji";
    is_add: boolean;
  };
  group_mute: {
    group_id: number;
    user_id: number;
    operator_id: number;
    duration: number;
  };
  group_whole_mute: { group_id: number; operator_id: number; is_mute: boolean };
  group_nudge: {
    group_id: number;
    sender_id: number;
    receiver_id: number;
    display_action: string;
    display_suffix: string;
    display_action_img_url: string;
  };
  group_file_upload: {
    group_id: number;
    user_id: number;
    file_id: string;
    file_name: string;
    file_size: number;
  };
}

export type MilkyEventType = keyof MilkyEventDataMap;

export type MilkyEvent = {
  [K in MilkyEventType]: {
    event_type: K;
    time: number;
    self_id: number;
    data: MilkyEventDataMap[K];
  };
}[MilkyEventType];

export type MilkyEventOf<K extends MilkyEventType> = Extract<
  MilkyEvent,
  { event_type: K }
>;

export interface MilkyLoginInfo {
  uin: number;
  nickname: string;
}

export interface MilkyImplInfo {
  impl_name: string;
  impl_version: string;
  qq_protocol_version: string;
  qq_protocol_type: string;
  milky_version: string;
}

export interface MilkySendMessageResult {
  message_seq: number;
  time: number;
}

export type MilkyGroupRequestType = "join_request" | "invited_join_request";

type Empty = Record<string, never>;

interface Api<P, R> {
  params: P;
  result: R;
}

export interface MilkyApiMap {
  get_login_info: Api<Empty, MilkyLoginInfo>;
  get_impl_info: Api<Empty, MilkyImplInfo>;
  get_user_profile: Api<{ user_id: number }, MilkyUserProfile>;
  get_friend_list: Api<{ no_cache?: boolean }, { friends: MilkyFriend[] }>;
  get_friend_info: Api<
    { user_id: number; no_cache?: boolean },
    { friend: MilkyFriend }
  >;
  get_group_list: Api<{ no_cache?: boolean }, { groups: MilkyGroup[] }>;
  get_group_info: Api<
    { group_id: number; no_cache?: boolean },
    { group: MilkyGroup }
  >;
  get_group_member_list: Api<
    { group_id: number; no_cache?: boolean },
    { members: MilkyGroupMember[] }
  >;
  get_group_member_info: Api<
    { group_id: number; user_id: number; no_cache?: boolean },
    { member: MilkyGroupMember }
  >;
  set_avatar: Api<{ uri: string }, Empty>;
  set_nickname: Api<{ new_nickname: string }, Empty>;
  set_bio: Api<{ new_bio: string }, Empty>;
  get_cookies: Api<{ domain: string }, { cookies: string }>;
  get_csrf_token: Api<Empty, { csrf_token: string }>;
  send_private_message: Api<
    { user_id: number; message: MilkyOutgoingSegment[] },
    MilkySendMessageResult
  >;
  send_group_message: Api<
    { group_id: number; message: MilkyOutgoingSegment[] },
    MilkySendMessageResult
  >;
  recall_private_message: Api<{ user_id: number; message_seq: number }, Empty>;
  recall_group_message: Api<{ group_id: number; message_seq: number }, Empty>;
  get_message: Api<
    { message_scene: MilkyMessageScene; peer_id: number; message_seq: number },
    { message: MilkyIncomingMessage }
  >;
  get_history_messages: Api<
    {
      message_scene: MilkyMessageScene;
      peer_id: number;
      start_message_seq?: number;
      limit?: number;
    },
    { messages: MilkyIncomingMessage[]; next_message_seq?: number | null }
  >;
  get_resource_temp_url: Api<{ resource_id: string }, { url: string }>;
  get_forwarded_messages: Api<
    { forward_id: string },
    { messages: MilkyIncomingForwardedMessage[] }
  >;
  mark_message_as_read: Api<
    { message_scene: MilkyMessageScene; peer_id: number; message_seq: number },
    Empty
  >;
  send_friend_nudge: Api<{ user_id: number; is_self?: boolean }, Empty>;
  send_profile_like: Api<{ user_id: number; count?: number }, Empty>;
  delete_friend: Api<{ user_id: number }, Empty>;
  accept_friend_request: Api<
    { initiator_uid: string; is_filtered?: boolean },
    Empty
  >;
  reject_friend_request: Api<
    { initiator_uid: string; is_filtered?: boolean; reason?: string },
    Empty
  >;
  set_group_name: Api<{ group_id: number; new_group_name: string }, Empty>;
  set_group_avatar: Api<{ group_id: number; image_uri: string }, Empty>;
  set_group_member_card: Api<
    { group_id: number; user_id: number; card: string },
    Empty
  >;
  set_group_member_special_title: Api<
    { group_id: number; user_id: number; special_title: string },
    Empty
  >;
  set_group_member_admin: Api<
    { group_id: number; user_id: number; is_set?: boolean },
    Empty
  >;
  set_group_member_mute: Api<
    { group_id: number; user_id: number; duration?: number },
    Empty
  >;
  set_group_whole_mute: Api<{ group_id: number; is_mute?: boolean }, Empty>;
  kick_group_member: Api<
    { group_id: number; user_id: number; reject_add_request?: boolean },
    Empty
  >;
  set_group_essence_message: Api<
    { group_id: number; message_seq: number; is_set?: boolean },
    Empty
  >;
  quit_group: Api<{ group_id: number }, Empty>;
  send_group_message_reaction: Api<
    {
      group_id: number;
      message_seq: number;
      reaction: string;
      reaction_type?: "face" | "emoji";
      is_add?: boolean;
    },
    Empty
  >;
  send_group_nudge: Api<{ group_id: number; user_id: number }, Empty>;
  accept_group_request: Api<
    {
      notification_seq: number;
      notification_type: MilkyGroupRequestType;
      group_id: number;
      is_filtered?: boolean;
    },
    Empty
  >;
  reject_group_request: Api<
    {
      notification_seq: number;
      notification_type: MilkyGroupRequestType;
      group_id: number;
      is_filtered?: boolean;
      reason?: string;
    },
    Empty
  >;
  accept_group_invitation: Api<
    { group_id: number; invitation_seq: number },
    Empty
  >;
  reject_group_invitation: Api<
    { group_id: number; invitation_seq: number },
    Empty
  >;
  upload_private_file: Api<
    { user_id: number; file_uri: string; file_name: string },
    { file_id: string }
  >;
  upload_group_file: Api<
    {
      group_id: number;
      parent_folder_id?: string;
      file_uri: string;
      file_name: string;
    },
    { file_id: string }
  >;
}

export type MilkyApiName = keyof MilkyApiMap;

export type MilkyApiParams<K extends MilkyApiName> = MilkyApiMap[K]["params"];

export type MilkyApiResult<K extends MilkyApiName> = MilkyApiMap[K]["result"];
