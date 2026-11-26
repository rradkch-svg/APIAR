"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Grid3X3, Lock, Star, Unlock, X } from "lucide-react";
import type { MediaTierInfo } from "@/lib/media/tiers";
import type { FeedPostItem } from "./PostCard";

export interface CrewMemberDetail {
  id: string;
  display_name: string;
  handle: string;
  clique: string;
  archetype: string;
  avatar_url: string | null;
  accent_color: string;
  age: number;
  bio: string;
  gossip_propensity: number;
  visual_anchor: string;
  affinity: number;
  trust: number;
  romantic_tension: number;
  current_mood: string;
  internal_thought: string;
  relationship_stage: string;
  user_follows?: boolean;
  persona_follows_back?: boolean;
  is_close_friend?: boolean;
  persona_added_close_friend?: boolean;
  is_online: boolean;
  media_tier: MediaTierInfo;
  memories: Array<{
    id: string;
    fact: string;
    category: string;
    importance: number;
    source_type: string;
    leaked_by_persona: string | null;
    created_at: string;
  }>;
  connections: Array<{
    target_id: string;
    target_name: string;
    target_accent: string;
    relation_type: string;
    affinity: number;
    friction: number;
    gossip_trust: number;
    shared_lore: string;
  }>;
}

interface PersonaDrawerProps {
  persona: CrewMemberDetail | null;
  onClose: () => void;
  onFollowChanged?: () => void;
}

export function PersonaDrawer({ persona, onClose, onFollowChanged }: PersonaDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [tab, setTab] = useState<"posts" | "insights" | "connections">("posts");
  const [personaPosts, setPersonaPosts] = useState<FeedPostItem[]>([]);
  const [following, setFollowing] = useState(false);
  const [closeFriend, setCloseFriend] = useState(false);
  const [busyFollow, setBusyFollow] = useState(false);
  const [cfMessage, setCfMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (persona && !dialog.open) {
      setTab("posts");
      setFollowing(Boolean(persona.user_follows));
      setCloseFriend(Boolean(persona.is_close_friend));
      setCfMessage(null);
      dialog.showModal();
      void fetch(`/api/v1/feed?persona_id=${persona.id}&limit=24`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { posts: [] }))
        .then((d: { posts?: FeedPostItem[] }) => setPersonaPosts(d.posts || []));
    } else if (!persona && dialog.open) {
      dialog.close();
    }
  }, [persona]);

  const toggleFollow = async () => {
    if (!persona || busyFollow) return;
    setBusyFollow(true);
    try {
      const res = await fetch(`/api/v1/personas/${persona.id}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_follow" }),
      });
      if (res.ok) {
        const d = await res.json();
        setFollowing(Boolean(d.user_follows));
        onFollowChanged?.();
      }
    } finally {
      setBusyFollow(false);
    }
  };

  const toggleCloseFriend = async () => {
    if (!persona) return;
    setCfMessage(null);
    const res = await fetch(`/api/v1/personas/${persona.id}/follow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_close_friend" }),
    });
    const d = await res.json();
    if (!res.ok) {
      setCfMessage(d.error || "Get closer first to add to Close Friends.");
      return;
    }
    setCloseFriend(Boolean(d.is_close_friend));
    onFollowChanged?.();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="circle-dialog w-full"
    >
      {persona && (
        <div className="circle-scroll flex max-h-[88dvh] flex-col overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0D0E12]">
          {/* Header matching Instagram profile */}
          <div className="sticky top-0 z-10 flex h-[48px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12]/95 px-4 backdrop-blur-md">
            <h1 id={titleId} className="text-[16px] font-semibold text-white">
              {persona.handle.replace(/^@/, "")}
            </h1>
            <button
              type="button"
              autoFocus
              onClick={onClose}
              aria-label="Close profile"
              className="rounded-full p-1 text-[#8E8E93] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Identity Block */}
          <div className="px-4 pt-4 pb-4">
            <div className="flex items-center gap-5">
              <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-full bg-[#262930]">
                {persona.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={persona.avatar_url}
                    alt={persona.display_name}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-bold text-white">
                    {persona.display_name.slice(0, 1)}
                  </div>
                )}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-white">
                    {persona.display_name}
                  </span>
                  {persona.persona_follows_back && (
                    <span className="rounded bg-[#18191E] px-1.5 py-0.5 text-[10px] text-[#8E8E93]">
                      Follows you
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between pr-2">
                  <div className="text-center">
                    <div className="text-[15px] font-bold tabular-nums text-white">
                      {personaPosts.length}
                    </div>
                    <div className="text-[11px] text-[#8E8E93]">posts</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[15px] font-bold tabular-nums text-white">
                      {persona.connections.length}
                    </div>
                    <div className="text-[11px] text-[#8E8E93]">mutuals</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[15px] font-bold capitalize text-white">
                      {persona.relationship_stage}
                    </div>
                    <div className="text-[11px] text-[#8E8E93]">status</div>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-[14px] leading-[1.4] text-white/95">{persona.bio}</p>
            <p className="mt-1 text-[12px] text-[#8E8E93]">
              {persona.age} · {persona.archetype}
            </p>

            {/* Instagram Action Row: Follow / Following + Message + Close Friends Star */}
            <div className="mt-3.5 flex items-center gap-2">
              <button
                type="button"
                disabled={busyFollow}
                onClick={() => void toggleFollow()}
                className={`h-[34px] flex-1 rounded-full text-[14px] font-semibold transition ${
                  following ? "bg-[#262930] text-white" : "bg-[#5E5CE6] text-white"
                }`}
              >
                {following ? "Following" : "Follow"}
              </button>
              <Link
                href={`/dms/${persona.id}`}
                onClick={onClose}
                className="flex h-[34px] flex-1 items-center justify-center rounded-full bg-[#262930] text-[14px] font-semibold text-white"
              >
                Message
              </Link>
              <button
                type="button"
                onClick={() => void toggleCloseFriend()}
                aria-label="Toggle Close Friend"
                title={closeFriend ? "In Close Friends" : "Add to Close Friends"}
                className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transition ${
                  closeFriend ? "bg-[#30D158] text-white" : "bg-[#262930] text-[#8E8E93]"
                }`}
              >
                <Star className={`h-4 w-4 ${closeFriend ? "fill-white" : ""}`} />
              </button>
            </div>
            {cfMessage && <p className="mt-2 text-[12px] text-[#8E8E93]">{cfMessage}</p>}
          </div>

          {/* 3 Clean Underline Tabs: Posts | Insights | Connections */}
          <div className="grid grid-cols-3 border-y border-white/[0.08] text-[13px] font-semibold">
            <button
              type="button"
              onClick={() => setTab("posts")}
              className={`flex items-center justify-center gap-1.5 py-2.5 transition ${
                tab === "posts"
                  ? "border-b-2 border-white text-white"
                  : "text-[#8E8E93] hover:text-white"
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
              <span>Posts</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("insights")}
              className={`py-2.5 text-center transition ${
                tab === "insights"
                  ? "border-b-2 border-white text-white"
                  : "text-[#8E8E93] hover:text-white"
              }`}
            >
              Insights
            </button>
            <button
              type="button"
              onClick={() => setTab("connections")}
              className={`py-2.5 text-center transition ${
                tab === "connections"
                  ? "border-b-2 border-white text-white"
                  : "text-[#8E8E93] hover:text-white"
              }`}
            >
              Graph ({persona.connections.length})
            </button>
          </div>

          {/* Tab Body */}
          {tab === "posts" ? (
            personaPosts.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[#8E8E93]">
                No campus posts from @{persona.handle.replace(/^@/, "")} yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-[2px] p-[2px]">
                {personaPosts.map((p) => (
                  <div
                    key={p.id}
                    className="aspect-square w-full overflow-hidden bg-[#26282C]"
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.body}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-white">
                        <span className="line-clamp-4">{p.body}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : tab === "insights" ? (
            <div className="space-y-3 p-4">
              {/* Relationship Metrics */}
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#18191E] p-3 text-center">
                <div>
                  <div className="text-[15px] font-bold tabular-nums text-white">
                    {persona.affinity}%
                  </div>
                  <div className="text-[11px] text-[#8E8E93]">affinity</div>
                </div>
                <div>
                  <div className="text-[15px] font-bold tabular-nums text-white">
                    {persona.trust}%
                  </div>
                  <div className="text-[11px] text-[#8E8E93]">trust</div>
                </div>
                <div>
                  <div className="text-[15px] font-bold tabular-nums text-white">
                    {persona.romantic_tension}%
                  </div>
                  <div className="text-[11px] text-[#8E8E93]">tension</div>
                </div>
              </div>

              {/* DM Media Unlocks */}
              <div className="rounded-2xl bg-[#18191E] p-3.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-white">DM Media Unlocks</span>
                  <span className="text-[#8E8E93]">{persona.media_tier.label}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#262930]">
                  <div
                    className="h-full rounded-full bg-[#5E5CE6] transition-all"
                    style={{ width: `${persona.media_tier.progressPercent}%` }}
                  />
                </div>
                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  {persona.media_tier.stages.map((st) => (
                    <div
                      key={st.id}
                      className={`rounded-xl px-1.5 py-2 text-center ${
                        st.unlocked ? "bg-[#262930] text-white" : "bg-[#0D0E12] text-[#8E8E93]"
                      }`}
                    >
                      <div className="flex justify-center">
                        {st.unlocked ? (
                          <Unlock className="h-3.5 w-3.5 text-[#5E5CE6]" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 text-[#8E8E93]" />
                        )}
                      </div>
                      <div className="mt-1 text-[11px] font-medium leading-tight">
                        {st.shortLabel}
                      </div>
                    </div>
                  ))}
                </div>
                {persona.media_tier.nextUnlockHint && (
                  <p className="mt-2 text-center text-[12px] text-[#8E8E93]">
                    {persona.media_tier.nextUnlockHint}
                  </p>
                )}
              </div>

              {/* Internal Thought & Memories */}
              <div className="rounded-2xl bg-[#18191E] p-3.5">
                <div className="text-[12px] font-medium text-[#8E8E93]">Private Impression</div>
                <p className="mt-1 text-[14px] leading-relaxed text-white">
                  “{persona.internal_thought || "Doesn't know you yet."}”
                </p>
              </div>

              {persona.memories.length === 0 ? (
                <p className="py-3 text-center text-[13px] text-[#8E8E93]">
                  No shared memories yet.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.08] rounded-2xl bg-[#18191E]">
                  {persona.memories.map((m) => (
                    <div key={m.id} className="px-3.5 py-3">
                      <div className="flex items-center justify-between text-[12px] text-[#8E8E93]">
                        <span className="capitalize">{m.category}</span>
                        <span>
                          {m.source_type === "gossip"
                            ? `Heard from @${m.leaked_by_persona || "someone"}`
                            : m.source_type}
                        </span>
                      </div>
                      <p className="mt-1 text-[14px] leading-snug text-white">{m.fact}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4">
              <div className="divide-y divide-white/[0.08] rounded-2xl bg-[#18191E]">
                {persona.connections.map((edge) => (
                  <div key={edge.target_id} className="px-3.5 py-3">
                    <div className="flex items-center justify-between text-[14px]">
                      <span className="font-semibold text-white">{edge.target_name}</span>
                      <span className="text-[12px] capitalize text-[#8E8E93]">
                        {edge.relation_type.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[#8E8E93]">{edge.shared_lore}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
