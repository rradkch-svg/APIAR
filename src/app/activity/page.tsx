"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Calendar, Flame, Heart, MessageCircle, UserPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/components/RealtimeProvider";
import { formatShortTime } from "@/components/PostCard";
import type { ConflictResponse } from "@/components/EventInviteCard";
import type { ActivityFeedItem } from "@/lib/types/activity";

export default function ActivityPage() {
  const { subscribe, refreshMe } = useRealtime();
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    eventId: string;
    data: ConflictResponse;
  } | null>(null);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/activity", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: ActivityFeedItem[] };
        setItems(data.items || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
    return subscribe((evName) => {
      if (
        evName === "feed:comment" ||
        evName === "feed:likes_bump" ||
        evName === "world:update" ||
        evName === "notification:push"
      ) {
        void loadActivity();
      }
    });
  }, [loadActivity, subscribe]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (conflictState && !dialog.open) dialog.showModal();
    else if (!conflictState && dialog.open) dialog.close();
  }, [conflictState]);

  const respondInvite = async (
    eventId: string,
    action: "accept" | "decline",
    confirmFlake = false
  ) => {
    setBusyId(eventId);
    try {
      const res = await fetch(`/api/v1/world-events/${eventId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm_flake: confirmFlake }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as ConflictResponse;
        setConflictState({ eventId, data });
        return;
      }
      if (res.ok) {
        setConflictState(null);
        await loadActivity();
        await refreshMe();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <header className="sticky top-0 z-20 flex h-[50px] items-center border-b border-white/[0.08] bg-[#0D0E12]/95 px-4 backdrop-blur-md">
        <h1 className="text-[19px] font-bold tracking-[-0.02em] text-white">Activity</h1>
      </header>

      {/* Pure flat vertical list — NO outer cards */}
      <div className="divide-y divide-white/[0.06]">
        {loading ? (
          [1, 2, 3, 4, 5].map((k) => (
            <div key={k} className="flex items-center gap-3 px-4 py-3.5">
              <div className="h-10 w-10 animate-pulse rounded-full bg-[#18191E]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-48 animate-pulse rounded bg-[#18191E]" />
                <div className="h-2.5 w-24 animate-pulse rounded bg-[#18191E]" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-6 py-16 text-center text-[14px] text-[#8E8E93]">
            No activity yet. Share a post or advance time in Settings to wake up campus.
          </div>
        ) : (
          items.map((item) => {
            const ev = item.world_event;
            const badgeIcon =
              item.kind === "like_summary" ? (
                <Heart className="h-2.5 w-2.5 fill-white text-white" />
              ) : item.kind === "comment" ? (
                <MessageCircle className="h-2.5 w-2.5 fill-white text-white" />
              ) : item.kind === "follow" ? (
                <UserPlus className="h-2.5 w-2.5 text-white" />
              ) : item.kind === "invite" ? (
                <Calendar className="h-2.5 w-2.5 text-white" />
              ) : (
                <Flame className="h-2.5 w-2.5 text-white" />
              );

            const badgeBg =
              item.kind === "like_summary"
                ? "bg-[#FF3B30]"
                : item.kind === "invite" || item.kind === "emotional_hook" || item.kind === "follow"
                  ? "bg-[#5E5CE6]"
                  : "bg-[#262930]";

            return (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                {/* Left Avatar + Mini Icon Badge */}
                <Link href={item.route} className="relative mt-0.5 shrink-0">
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-[#262930]">
                    {item.persona_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.persona_avatar}
                        alt={item.persona_name}
                        className="h-full w-full rounded-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">
                        {item.persona_name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#0D0E12] ${badgeBg}`}
                  >
                    {badgeIcon}
                  </span>
                </Link>

                {/* Inline Text + Timestamp + Inline Actions */}
                <div className="min-w-0 flex-1">
                  <Link href={item.route} className="block text-[14px] leading-[1.35] text-white">
                    <span className="mr-1 font-semibold">{item.persona_handle}</span>
                    <span className="text-white/90">{item.text}</span>{" "}
                    <span className="text-[12px] text-[#8E8E93]">
                      {formatShortTime(item.created_at)}
                    </span>
                  </Link>

                  {item.subtext && (
                    <p className="mt-0.5 text-[12px] text-[#8E8E93]">{item.subtext}</p>
                  )}

                  {/* Inline Accept / Decline for World Director Invites */}
                  {item.kind === "invite" && ev && (
                    <div className="mt-2 flex items-center gap-2">
                      {ev.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === ev.id}
                            onClick={() => void respondInvite(ev.id, "accept", false)}
                            className="rounded-full bg-[#5E5CE6] px-4 py-1 text-[13px] font-semibold text-white disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busyId === ev.id}
                            onClick={() => void respondInvite(ev.id, "decline", false)}
                            className="rounded-full bg-[#262930] px-4 py-1 text-[13px] font-semibold text-white disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <span className="text-[12px] font-medium capitalize text-[#8E8E93]">
                          {ev.status === "accepted"
                            ? "Accepted · On your schedule"
                            : ev.status === "completed"
                              ? "Completed"
                              : ev.status === "flaked"
                                ? "Canceled (flaked)"
                                : ev.status}
                        </span>
                      )}
                    </div>
                  )}

                  {item.kind === "emotional_hook" && ev?.status === "pending" && (
                    <div className="mt-2">
                      <Link
                        href={item.route}
                        className="inline-flex rounded-full bg-[#5E5CE6] px-4 py-1 text-[13px] font-semibold text-white"
                      >
                        Reply in DM
                      </Link>
                    </div>
                  )}
                </div>

                {/* Right 44x44 Post Thumbnail */}
                {item.post_thumbnail && (
                  <Link
                    href={item.route}
                    className="h-[44px] w-[44px] min-w-[44px] shrink-0 overflow-hidden rounded-md bg-[#26282C]"
                  >
                    {item.post_thumbnail.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.post_thumbnail.image_url}
                        alt="Post thumbnail"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-1 text-center text-[8px] leading-tight text-white/90">
                        <span className="line-clamp-3">{item.post_thumbnail.body}</span>
                      </div>
                    )}
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Native <dialog> Schedule Conflict Confirmation */}
      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        onClose={() => setConflictState(null)}
        className="circle-dialog w-full"
      >
        {conflictState && (
          <div className="rounded-2xl border border-white/[0.08] bg-[#18191E] p-5">
            <h1 id={headingId} className="text-[16px] font-semibold text-white">
              Schedule Conflict
            </h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#8E8E93]">
              {conflictState.data.message}
            </p>
            <p className="mt-2 text-[13px] text-[#8E8E93]">
              Switching will flake on {conflictState.data.existing_persona.display_name} (
              {conflictState.data.existing_event.penalty_affinity} affinity).
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={busyId === conflictState.eventId}
                onClick={() => void respondInvite(conflictState.eventId, "accept", true)}
                className="w-full rounded-full bg-[#FF453A] py-2.5 text-[14px] font-semibold text-white"
              >
                Flake &amp; Accept New Plan
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setConflictState(null)}
                className="w-full rounded-full bg-[#262930] py-2.5 text-[14px] font-semibold text-white"
              >
                Keep Existing Plan
              </button>
            </div>
          </div>
        )}
      </dialog>
    </AppShell>
  );
}
