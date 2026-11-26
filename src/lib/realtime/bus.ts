import { EventEmitter } from "events";

export type RealtimeEventName =
  | "typing:start"
  | "typing:stop"
  | "dm:bubble"
  | "dm:read"
  | "dm:reaction"
  | "feed:comment"
  | "feed:likes_bump"
  | "notification:push"
  | "world:update";

export interface RealtimePayloadMap {
  "typing:start": { persona_id: string; activity?: "typing" | "recording" | "sending_media" };
  "typing:stop": { persona_id: string };
  "dm:read": { persona_id: string; read_at: string };
  "dm:reaction": { persona_id: string; message_id: string; reaction: string | null };
  "dm:bubble": {
    persona_id: string;
    message: {
      id: string;
      user_id: string;
      persona_id: string;
      sender_type: "user" | "persona" | "system";
      message_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "screenshot_alert"
        | "post_share"
        | "event_invite"
        | "story_reply"
        | "note_reply";
      body: string;
      media_url: string | null;
      media_metadata: Record<string, unknown>;
      reaction?: string | null;
      reply_to_message_id?: string | null;
      read_at?: string | null;
      bubble_group_id: string | null;
      created_at: string;
    };
    state_update?: {
      affinity: number;
      trust: number;
      romantic_tension: number;
      current_mood: string;
      internal_thought: string;
      relationship_stage: string;
      persona_follows_back?: boolean;
      persona_added_close_friend?: boolean;
    };
  };
  "feed:comment": {
    post_id: string;
    comment: {
      id: string;
      post_id: string;
      parent_comment_id: string | null;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      author_name: string;
      author_handle: string;
      author_avatar: string | null;
      author_accent: string;
      body: string;
      likes_count: number;
      relation_to_parent?: string | null;
      created_at: string;
    };
  };
  "feed:likes_bump": {
    post_id: string;
    likes_count: number;
    views_count?: number;
  };
  "notification:push": {
    title: string;
    body: string;
    route: string;
    accent_color?: string;
    persona_id?: string;
  };
  "world:update": {
    current_day?: number;
    current_slot?: string;
    reason: string;
  };
}

export interface RealtimeEnvelope<E extends RealtimeEventName = RealtimeEventName> {
  event: E;
  userId: string;
  data: RealtimePayloadMap[E];
  timestamp: string;
}

const globalForBus = globalThis as unknown as {
  __velaRealtimeBus?: EventEmitter;
};

function getBus(): EventEmitter {
  if (!globalForBus.__velaRealtimeBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalForBus.__velaRealtimeBus = emitter;
  }
  return globalForBus.__velaRealtimeBus;
}

export function emitRealtimeEvent<E extends RealtimeEventName>(
  userId: string,
  event: E,
  data: RealtimePayloadMap[E]
): void {
  const envelope: RealtimeEnvelope<E> = {
    event,
    userId,
    data,
    timestamp: new Date().toISOString(),
  };
  getBus().emit(`user:${userId}`, envelope);
}

export function subscribeUserEvents(
  userId: string,
  listener: (envelope: RealtimeEnvelope) => void
): () => void {
  const bus = getBus();
  const channel = `user:${userId}`;
  bus.on(channel, listener);
  return () => {
    bus.off(channel, listener);
  };
}
