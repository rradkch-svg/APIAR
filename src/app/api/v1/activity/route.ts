import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { TIME_SLOT_META, type TimeSlot } from "@/lib/personas/metadata";

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

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const [worldRes, commentsRes, realLikesRes, followersRes, gossipRes] = await Promise.all([
      dbQuery<{
        id: string;
        persona_id: string;
        event_type: "spontaneous_ping" | "emotional_hook" | "invite";
        title: string;
        description: string;
        scheduled_day: number;
        scheduled_slot: TimeSlot;
        status: string;
        reward_affinity: number;
        created_at: string;
        persona_name: string;
        persona_handle: string;
        persona_avatar: string | null;
      }>(
        `SELECT
           we.*,
           p.display_name AS persona_name,
           p.handle AS persona_handle,
           p.avatar_url AS persona_avatar
         FROM world_events we
         JOIN personas p ON p.id = we.persona_id
         WHERE we.user_id = $1 AND we.event_type IN ('invite', 'emotional_hook')
         ORDER BY we.created_at DESC
         LIMIT 20`,
        [user.id]
      ),
      dbQuery<{
        id: string;
        post_id: string;
        parent_comment_id: string | null;
        body: string;
        created_at: string;
        author_persona_id: string;
        persona_name: string;
        persona_handle: string;
        persona_avatar: string | null;
        post_body: string;
        post_image_url: string | null;
        post_author_type: string;
      }>(
        `SELECT
           c.id, c.post_id, c.parent_comment_id, c.body, c.created_at,
           c.author_persona_id,
           per.display_name AS persona_name,
           per.handle AS persona_handle,
           per.avatar_url AS persona_avatar,
           p.body AS post_body,
           p.image_url AS post_image_url,
           p.author_type AS post_author_type
         FROM comments c
         JOIN posts p ON p.id = c.post_id
         JOIN personas per ON per.id = c.author_persona_id
         LEFT JOIN comments pc ON pc.id = c.parent_comment_id
         WHERE c.user_id = $1
           AND c.author_type = 'persona'
           AND (p.author_type = 'user' OR pc.author_type = 'user')
         ORDER BY c.created_at DESC
         LIMIT 25`,
        [user.id]
      ),
      // Real post likes from personas on the user's posts (ZERO fabricated round-robin likes!)
      dbQuery<{
        post_id: string;
        post_body: string;
        post_image_url: string | null;
        likes_count: number;
        liker_id: string;
        persona_name: string;
        persona_handle: string;
        persona_avatar: string | null;
        liked_at: string;
      }>(
        `SELECT DISTINCT ON (pl.post_id)
           p.id AS post_id,
           p.body AS post_body,
           p.image_url AS post_image_url,
           p.likes_count,
           per.id AS liker_id,
           per.display_name AS persona_name,
           per.handle AS persona_handle,
           per.avatar_url AS persona_avatar,
           pl.created_at AS liked_at
         FROM post_likes pl
         JOIN posts p ON p.id = pl.post_id
         JOIN personas per ON per.id = pl.liker_persona_id
         WHERE pl.user_id = $1 AND pl.liker_type = 'persona' AND p.author_type = 'user'
         ORDER BY pl.post_id, pl.created_at DESC`,
        [user.id]
      ),
      dbQuery<{
        persona_id: string;
        display_name: string;
        handle: string;
        avatar_url: string | null;
        updated_at: string;
      }>(
        `SELECT ups.persona_id, p.display_name, p.handle, p.avatar_url, ups.updated_at
         FROM user_persona_state ups
         JOIN personas p ON p.id = ups.persona_id
         WHERE ups.user_id = $1 AND ups.persona_follows_back = TRUE
         ORDER BY ups.updated_at DESC
         LIMIT 15`,
        [user.id]
      ),
      dbQuery<{
        id: string;
        origin_persona_id: string;
        summary: string;
        juiciness: number;
        reached_personas: string[];
        created_at: string;
        persona_name: string;
        persona_handle: string;
        persona_avatar: string | null;
      }>(
        `SELECT
           ge.*,
           p.display_name AS persona_name,
           p.handle AS persona_handle,
           p.avatar_url AS persona_avatar
         FROM gossip_events ge
         JOIN personas p ON p.id = ge.origin_persona_id
         WHERE ge.user_id = $1
         ORDER BY ge.created_at DESC
         LIMIT 8`,
        [user.id]
      ),
    ]);

    const slotCounts = new Map<string, number>();
    for (const we of worldRes.rows) {
      if (we.event_type === "invite" && (we.status === "pending" || we.status === "accepted")) {
        const key = `${we.scheduled_day}:${we.scheduled_slot}`;
        slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
      }
    }

    const items: ActivityFeedItem[] = [];

    for (const f of followersRes.rows) {
      items.push({
        id: `follow-${f.persona_id}`,
        kind: "follow",
        persona_id: f.persona_id,
        persona_name: f.display_name,
        persona_handle: f.handle.replace(/^@/, ""),
        persona_avatar: f.avatar_url,
        text: "started following you.",
        created_at: f.updated_at,
        route: `/dms/${f.persona_id}`,
      });
    }

    for (const we of worldRes.rows) {
      const slotMeta = TIME_SLOT_META[we.scheduled_slot];
      const key = `${we.scheduled_day}:${we.scheduled_slot}`;
      const hasConflict =
        we.event_type === "invite" &&
        (we.status === "pending" || we.status === "accepted") &&
        (slotCounts.get(key) || 0) > 1;

      items.push({
        id: `we-${we.id}`,
        kind: we.event_type === "emotional_hook" ? "emotional_hook" : "invite",
        persona_id: we.persona_id,
        persona_name: we.persona_name,
        persona_handle: we.persona_handle.replace(/^@/, ""),
        persona_avatar: we.persona_avatar,
        text:
          we.event_type === "emotional_hook"
            ? `reached out late: ${we.title}`
            : `invited you to ${we.title}`,
        subtext:
          we.event_type === "emotional_hook"
            ? we.description
            : `Day ${we.scheduled_day} · ${slotMeta?.label || we.scheduled_slot}${hasConflict ? " · Schedule conflict" : ""}`,
        created_at: we.created_at,
        route: `/dms/${we.persona_id}`,
        world_event: {
          id: we.id,
          title: we.title,
          status: we.status,
          scheduled_day: we.scheduled_day,
          scheduled_slot: we.scheduled_slot,
          slot_label: slotMeta?.label || we.scheduled_slot,
          reward_affinity: we.reward_affinity,
          has_conflict: hasConflict,
        },
      });
    }

    for (const c of commentsRes.rows) {
      items.push({
        id: `c-${c.id}`,
        kind: "comment",
        persona_id: c.author_persona_id,
        persona_name: c.persona_name,
        persona_handle: c.persona_handle.replace(/^@/, ""),
        persona_avatar: c.persona_avatar,
        text: c.parent_comment_id
          ? `replied to your comment: "${c.body}"`
          : `commented: "${c.body}"`,
        created_at: c.created_at,
        route: "/feed",
        post_thumbnail: {
          post_id: c.post_id,
          image_url: c.post_image_url,
          body: c.post_body,
        },
      });
    }

    for (const l of realLikesRes.rows) {
      const others = Math.max(0, l.likes_count - 1);
      items.push({
        id: `like-${l.post_id}`,
        kind: "like_summary",
        persona_id: l.liker_id,
        persona_name: l.persona_name,
        persona_handle: l.persona_handle.replace(/^@/, ""),
        persona_avatar: l.persona_avatar,
        text: others > 0 ? `and ${others} others liked your post.` : `liked your post.`,
        created_at: l.liked_at,
        route: "/feed",
        post_thumbnail: {
          post_id: l.post_id,
          image_url: l.post_image_url,
          body: l.post_body,
        },
      });
    }

    for (const g of gossipRes.rows) {
      if (g.reached_personas.length === 0) continue;
      items.push({
        id: `g-${g.id}`,
        kind: "gossip",
        persona_id: g.origin_persona_id,
        persona_name: g.persona_name,
        persona_handle: g.persona_handle.replace(/^@/, ""),
        persona_avatar: g.persona_avatar,
        text: `talked about your secret with ${g.reached_personas.join(", ")}.`,
        subtext: g.summary,
        created_at: g.created_at,
        route: "/crew",
      });
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      items,
      pending_invites_count: items.filter(
        (i) => i.kind === "invite" && i.world_event?.status === "pending"
      ).length,
      pending_hooks_count: items.filter(
        (i) => i.kind === "emotional_hook" && i.world_event?.status === "pending"
      ).length,
    });
  } catch (err) {
    console.error("[GET /api/v1/activity] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load activity" },
      { status: 500 }
    );
  }
}
