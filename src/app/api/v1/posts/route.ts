import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { consumeUserEnergy, getActiveUser } from "@/lib/db/session";
import { captionUserPostImage } from "@/lib/llm/router";
import { computeInitialPostEngagement, scheduleFeedCascadeJobs } from "@/lib/graph/selector";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

const createPostSchema = z.object({
  body: z.string().trim().min(1).max(600),
  image_url: z.string().trim().optional().nullable(),
  media_urls: z.array(z.string().trim().min(1)).max(8).optional(),
  location_tag: z.string().trim().max(80).optional().nullable(),
  audience: z.enum(["campus", "close_friends"]).optional().default("campus"),
});

export async function POST(req: Request) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) {
      return NextResponse.json({ error: "Onboarding required" }, { status: 401 });
    }

    const json = await req.json();
    const parsed = createPostSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Post cannot be empty", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const energyRes = await consumeUserEnergy(user.id, 1);
    if (!energyRes.ok) {
      return NextResponse.json(
        {
          error: "Out of daily energy! Advance +24h in Settings or switch to Pro.",
          energy: energyRes.energy,
          max_energy: energyRes.max_energy,
        },
        { status: 429 }
      );
    }

    const mediaUrls =
      parsed.data.media_urls && parsed.data.media_urls.length > 0
        ? parsed.data.media_urls
        : parsed.data.image_url?.trim()
          ? [parsed.data.image_url.trim()]
          : [];
    const primaryImage = mediaUrls[0] || null;
    const locationTag = parsed.data.location_tag?.trim() || null;
    const audience = parsed.data.audience;

    const imageCaption = primaryImage
      ? await captionUserPostImage(primaryImage, parsed.data.body)
      : null;

    const engagement = await computeInitialPostEngagement(user.id, parsed.data.body, true);

    const post = await dbQueryOne<{
      id: string;
      body: string;
      image_url: string | null;
      media_urls: string[];
      location_tag: string | null;
      audience: string;
      liked_by_user: boolean;
      image_caption_ai: string | null;
      likes_count: number;
      views_count: number;
      created_at: string;
    }>(
      `INSERT INTO posts (
        user_id, author_type, author_persona_id, body, image_url, media_urls,
        location_tag, audience, image_caption_ai, likes_count, views_count
      ) VALUES ($1, 'user', NULL, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
      RETURNING id, body, image_url, media_urls, location_tag, audience, liked_by_user,
                image_caption_ai, likes_count, views_count, created_at`,
      [
        user.id,
        parsed.data.body,
        primaryImage,
        JSON.stringify(mediaUrls),
        locationTag,
        audience,
        imageCaption,
        engagement.likesCount,
        engagement.viewsCount,
      ]
    );

    if (!post) {
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }

    const cascade = await scheduleFeedCascadeJobs({
      userId: user.id,
      postId: post.id,
      postBody: post.body,
      imageCaption,
      currentSlot: user.current_slot,
      isUserPost: true,
      audience,
    });

    for (const pid of cascade.scheduledCommenters.slice(0, 2)) {
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'memory_extract', $2::jsonb, NOW(), 'pending')`,
        [
          user.id,
          JSON.stringify({
            persona_id: pid,
            source_type: "feed",
            recent_messages: [
              `Feed post: ${post.body}${imageCaption ? ` [photo: ${imageCaption}]` : ""}`,
            ],
          }),
        ]
      );
    }

    return NextResponse.json(
      {
        post: {
          ...post,
          author_type: "user",
          author_persona_id: null,
          author_name: user.display_name,
          author_handle: user.handle,
          author_avatar: user.avatar_url,
          author_accent: "#5E5CE6",
          author_clique: user.context_tag,
          saved_by_user: false,
          user_follows_author: false,
          liked_by_handles: [],
          comments: [],
        },
        cascade,
        energy: energyRes.energy,
        max_energy: energyRes.max_energy,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/v1/posts] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to publish post" },
      { status: 500 }
    );
  }
}
