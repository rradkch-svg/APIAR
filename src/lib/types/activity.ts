export interface ActivityFeedItem {
  id: string;
  kind: "invite" | "emotional_hook" | "comment" | "like_summary" | "gossip" | "follow";
  persona_id: string | null;
  persona_name: string;
  persona_handle: string;
  persona_avatar: string | null;
  text: string;
  subtext?: string;
  created_at: string;
  route: string;
  post_thumbnail?: {
    post_id: string;
    image_url: string | null;
    body: string;
  } | null;
  world_event?: {
    id: string;
    title: string;
    status: string;
    scheduled_day: number;
    scheduled_slot: string;
    slot_label: string;
    reward_affinity: number;
    has_conflict: boolean;
  } | null;
}
