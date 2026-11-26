"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Heart, ImagePlus, Plus, Send, Star, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  PostCard,
  type FeedCommentNode,
  type FeedPostItem,
  type ShareRecipient,
} from "@/components/PostCard";
import { useRealtime } from "@/components/RealtimeProvider";
import { VelaLogo } from "@/components/VelaLogo";

interface StorySlide {
  id: string;
  media_url: string;
  caption: string;
  audience: string;
  viewed_by_user: boolean;
  liked_by_user: boolean;
  created_at: string;
}

interface StoryGroup {
  author_key: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  author_name: string;
  author_handle: string;
  author_avatar: string | null;
  has_unseen: boolean;
  is_close_friends: boolean;
  slides: StorySlide[];
}

function insertCommentIntoPost(post: FeedPostItem, incoming: FeedCommentNode): FeedPostItem {
  for (const c of post.comments) {
    if (c.id === incoming.id) return post;
    if (c.replies?.some((r) => r.id === incoming.id)) return post;
  }
  if (incoming.parent_comment_id) {
    return {
      ...post,
      comments: post.comments.map((c) =>
        c.id === incoming.parent_comment_id
          ? { ...c, replies: [...(c.replies || []), incoming] }
          : c
      ),
    };
  }
  return {
    ...post,
    comments: [...post.comments, { ...incoming, replies: [] }],
  };
}

export default function FeedPage() {
  const { subscribe, me, pushToast } = useRealtime();
  const [posts, setPosts] = useState<FeedPostItem[]>([]);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [recipients, setRecipients] = useState<ShareRecipient[]>([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState<number | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [storyReply, setStoryReply] = useState("");
  const [sendingStoryReply, setSendingStoryReply] = useState(false);

  const [createStoryOpen, setCreateStoryOpen] = useState(false);
  const [newStoryPhoto, setNewStoryPhoto] = useState<string | null>(null);
  const [newStoryCaption, setNewStoryCaption] = useState("");
  const [newStoryAudience, setNewStoryAudience] = useState<"campus" | "close_friends">("campus");
  const [postingStory, setPostingStory] = useState(false);

  const [loading, setLoading] = useState(true);
  const storyDialogRef = useRef<HTMLDialogElement | null>(null);
  const createStoryDialogRef = useRef<HTMLDialogElement | null>(null);
  const storyTitleId = useId();

  const fetchFeedAndStories = useCallback(async () => {
    try {
      const [feedRes, storiesRes, crewRes] = await Promise.all([
        fetch("/api/v1/feed", { cache: "no-store" }),
        fetch("/api/v1/stories", { cache: "no-store" }),
        fetch("/api/v1/graph/crew", { cache: "no-store" }),
      ]);
      if (feedRes.ok) {
        const data = (await feedRes.json()) as { posts: FeedPostItem[] };
        setPosts(data.posts || []);
      }
      if (storiesRes.ok) {
        const data = (await storiesRes.json()) as { stories: StoryGroup[] };
        setStoryGroups(data.stories || []);
      }
      if (crewRes.ok) {
        const crewData = (await crewRes.json()) as { crew: ShareRecipient[] };
        setRecipients(crewData.crew || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeedAndStories();
    return subscribe((evName, data) => {
      if (evName === "feed:comment") {
        const postId = String(data.post_id || "");
        const comment = data.comment as FeedCommentNode | undefined;
        if (postId && comment) {
          setPosts((prev) =>
            prev.map((p) => (p.id === postId ? insertCommentIntoPost(p, comment) : p))
          );
        }
      } else if (evName === "feed:likes_bump") {
        const postId = String(data.post_id || "");
        const likes = Number(data.likes_count);
        const views = data.views_count !== undefined ? Number(data.views_count) : undefined;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  likes_count: Number.isFinite(likes) ? likes : p.likes_count,
                  views_count: views !== undefined && Number.isFinite(views) ? views : p.views_count,
                }
              : p
          )
        );
      } else if (evName === "world:update") {
        void fetchFeedAndStories();
      }
    });
  }, [fetchFeedAndStories, subscribe]);

  const activeGroup = activeGroupIdx !== null ? storyGroups[activeGroupIdx] || null : null;
  const activeSlide = activeGroup ? activeGroup.slides[activeSlideIdx] || activeGroup.slides[0] : null;

  useEffect(() => {
    const dialog = storyDialogRef.current;
    if (!dialog) return;
    if (activeGroup && !dialog.open) dialog.showModal();
    else if (!activeGroup && dialog.open) dialog.close();
  }, [activeGroup]);

  useEffect(() => {
    const dialog = createStoryDialogRef.current;
    if (!dialog) return;
    if (createStoryOpen && !dialog.open) dialog.showModal();
    else if (!createStoryOpen && dialog.open) dialog.close();
  }, [createStoryOpen]);

  // Mark story viewed when opened
  useEffect(() => {
    if (!activeSlide || !activeGroup || activeGroup.author_type === "user") return;
    if (!activeSlide.viewed_by_user) {
      void fetch(`/api/v1/stories/${activeSlide.id}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view" }),
      });
      setStoryGroups((prev) =>
        prev.map((g, gi) =>
          gi === activeGroupIdx
            ? {
                ...g,
                slides: g.slides.map((s) =>
                  s.id === activeSlide.id ? { ...s, viewed_by_user: true } : s
                ),
                has_unseen: g.slides.some((s) => s.id !== activeSlide.id && !s.viewed_by_user),
              }
            : g
        )
      );
    }
  }, [activeSlide, activeGroup, activeGroupIdx]);

  const handleLike = async (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const nextLiked = !p.liked_by_user;
        return {
          ...p,
          liked_by_user: nextLiked,
          likes_count: Math.max(0, p.likes_count + (nextLiked ? 1 : -1)),
        };
      })
    );
    await fetch(`/api/v1/posts/${postId}/like`, { method: "POST" });
  };

  const handleSave = async (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, saved_by_user: !p.saved_by_user } : p))
    );
    await fetch(`/api/v1/posts/${postId}/save`, { method: "POST" });
  };

  const handleComment = async (
    postId: string,
    body: string,
    parentCommentId?: string | null
  ) => {
    const res = await fetch(`/api/v1/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parent_comment_id: parentCommentId ?? null }),
    });
    if (res.ok) {
      const data = (await res.json()) as { comment: FeedCommentNode };
      if (data.comment) {
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? insertCommentIntoPost(p, data.comment) : p))
        );
      }
    }
  };

  const handleFollow = async (personaId: string) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.author_persona_id === personaId
          ? { ...p, user_follows_author: !p.user_follows_author }
          : p
      )
    );
    await fetch(`/api/v1/personas/${personaId}/follow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_follow" }),
    });
  };

  const toggleStoryLike = async () => {
    if (!activeSlide || activeGroupIdx === null) return;
    const nextLiked = !activeSlide.liked_by_user;
    setStoryGroups((prev) =>
      prev.map((g, gi) =>
        gi === activeGroupIdx
          ? {
              ...g,
              slides: g.slides.map((s) =>
                s.id === activeSlide.id ? { ...s, liked_by_user: nextLiked } : s
              ),
            }
          : g
      )
    );
    await fetch(`/api/v1/stories/${activeSlide.id}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "like" }),
    });
  };

  const submitStoryReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSlide || !storyReply.trim() || sendingStoryReply) return;
    setSendingStoryReply(true);
    try {
      const res = await fetch(`/api/v1/stories/${activeSlide.id}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", reply_text: storyReply.trim() }),
      });
      if (res.ok) {
        setStoryReply("");
        setActiveGroupIdx(null);
        pushToast({
          title: "Reply sent",
          body: `Replied to ${activeGroup?.author_name}'s story`,
          route: activeGroup?.author_persona_id ? `/dms/${activeGroup.author_persona_id}` : "/dms",
        });
      }
    } finally {
      setSendingStoryReply(false);
    }
  };

  const handleStoryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setNewStoryPhoto(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const publishStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoryPhoto || postingStory) return;
    setPostingStory(true);
    try {
      const res = await fetch("/api/v1/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_url: newStoryPhoto,
          caption: newStoryCaption.trim(),
          audience: newStoryAudience,
        }),
      });
      if (res.ok) {
        setNewStoryPhoto(null);
        setNewStoryCaption("");
        setCreateStoryOpen(false);
        void fetchFeedAndStories();
      }
    } finally {
      setPostingStory(false);
    }
  };

  const stepStory = (dir: 1 | -1) => {
    if (activeGroupIdx === null || !activeGroup) return;
    const nextSlide = activeSlideIdx + dir;
    if (nextSlide >= 0 && nextSlide < activeGroup.slides.length) {
      setActiveSlideIdx(nextSlide);
      return;
    }
    const nextGroup = activeGroupIdx + dir;
    if (nextGroup >= 0 && nextGroup < storyGroups.length) {
      setActiveGroupIdx(nextGroup);
      setActiveSlideIdx(0);
      return;
    }
    setActiveGroupIdx(null);
  };

  const unreadTotal = me?.unread_total ?? 0;
  const userInitial = (me?.user?.display_name || "Y").slice(0, 1).toUpperCase();
  const userStoryIdx = storyGroups.findIndex((g) => g.author_type === "user");
  const userStoryGroup = userStoryIdx >= 0 ? storyGroups[userStoryIdx] : null;
  const personaStories = storyGroups
    .map((g, idx) => ({ group: g, idx }))
    .filter((x) => x.group.author_type === "persona");

  return (
    <AppShell>
      {/* Native Instagram Header: Vela Logo Left + Paper-Plane DMs Right */}
      <header className="sticky top-0 z-20 flex h-[50px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12]/95 px-4 backdrop-blur-md">
        <Link href="/feed" aria-label="Vela Home">
          <VelaLogo size="sm" />
        </Link>

        <Link
          href="/dms"
          aria-label="Direct Messages"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-white transition active:scale-95"
        >
          <Send className="h-[22px] w-[22px]" strokeWidth={1.9} />
          {unreadTotal > 0 && (
            <span className="absolute top-0.5 right-0 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[10px] font-bold text-white">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </Link>
      </header>

      {/* Real 24h Horizontal Stories Rail */}
      <section
        aria-label="Stories"
        className="no-scrollbar flex gap-3.5 overflow-x-auto border-b border-white/[0.08] px-3.5 py-3"
      >
        {/* Your Story */}
        <div className="flex w-[66px] shrink-0 flex-col items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (userStoryGroup) {
                  setActiveGroupIdx(userStoryIdx);
                  setActiveSlideIdx(0);
                } else {
                  setCreateStoryOpen(true);
                }
              }}
              className={`flex h-[64px] w-[64px] items-center justify-center rounded-full p-[2.5px] ${
                userStoryGroup ? "ig-story-ring" : "bg-[#18191E]"
              }`}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#0D0E12] p-[2px]">
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#262930] text-lg font-semibold text-white">
                  {me?.user?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={me.user.avatar_url}
                      alt="Your story"
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    userInitial
                  )}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setCreateStoryOpen(true)}
              aria-label="Add to your story"
              className="absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0D0E12] bg-[#5E5CE6] text-white"
            >
              <Plus className="h-3 w-3" strokeWidth={3} />
            </button>
          </div>
          <span className="w-full truncate text-center text-[11px] text-[#8E8E93]">
            Your story
          </span>
        </div>

        {/* Active Campus Stories */}
        {personaStories.map(({ group, idx }) => (
          <button
            key={group.author_key}
            type="button"
            onClick={() => {
              setActiveGroupIdx(idx);
              setActiveSlideIdx(0);
            }}
            className="flex w-[66px] shrink-0 flex-col items-center gap-1.5"
          >
            <div
              className={`h-[64px] w-[64px] rounded-full p-[2.5px] ${
                group.has_unseen
                  ? group.is_close_friends
                    ? "bg-[#30D158]"
                    : "ig-story-ring"
                  : "bg-white/[0.16]"
              }`}
            >
              <div className="h-full w-full overflow-hidden rounded-full bg-[#0D0E12] p-[2px]">
                {group.author_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.author_avatar}
                    alt={group.author_name}
                    className="h-full w-full rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#262930] text-sm font-semibold">
                    {group.author_name.slice(0, 1)}
                  </div>
                )}
              </div>
            </div>
            <span className="w-full truncate text-center text-[11px] text-white/90">
              {group.author_handle}
            </span>
          </button>
        ))}
      </section>

      {/* Edge-to-Edge Full-Bleed Feed */}
      <div>
        {loading ? (
          <div className="divide-y divide-white/[0.08]">
            {[1, 2, 3].map((k) => (
              <div key={k} className="py-4">
                <div className="mx-3.5 mb-3 flex items-center gap-2.5">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-[#18191E]" />
                  <div className="h-3 w-28 animate-pulse rounded bg-[#18191E]" />
                </div>
                <div className="h-72 w-full animate-pulse bg-[#18191E]" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[15px] font-semibold text-white">No posts yet</p>
            <p className="mt-1 text-[13px] text-[#8E8E93]">
              Tap + below to share your first campus photo.
            </p>
            <Link
              href="/compose"
              className="mt-4 inline-flex rounded-full bg-[#5E5CE6] px-6 py-2.5 text-[14px] font-semibold text-white"
            >
              Create Post
            </Link>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onLike={handleLike}
              onSave={handleSave}
              onComment={handleComment}
              onFollow={handleFollow}
              shareRecipients={recipients}
            />
          ))
        )}
      </div>

      {/* Native <dialog> 9:16 Instagram Story Viewer */}
      <dialog
        ref={storyDialogRef}
        aria-labelledby={storyTitleId}
        onClose={() => setActiveGroupIdx(null)}
        className="circle-dialog w-full"
      >
        {activeGroup && activeSlide && (
          <div className="relative overflow-hidden rounded-[22px] border border-white/[0.1] bg-[#0D0E12]">
            {/* Multi-segment progress bar */}
            <div className="absolute top-2.5 right-3 left-3 z-20 flex gap-1">
              {activeGroup.slides.map((s, idx) => (
                <div key={s.id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full bg-white transition-all"
                    style={{ width: idx <= activeSlideIdx ? "100%" : "0%" }}
                  />
                </div>
              ))}
            </div>

            {/* Header overlay */}
            <div className="absolute top-5 right-3 left-3 z-20 flex items-center justify-between">
              <Link
                href={
                  activeGroup.author_persona_id
                    ? `/crew?inspect=${activeGroup.author_persona_id}`
                    : "/profile"
                }
                onClick={() => setActiveGroupIdx(null)}
                className="flex items-center gap-2"
              >
                <div className="h-8 w-8 overflow-hidden rounded-full bg-[#262930]">
                  {activeGroup.author_avatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeGroup.author_avatar}
                      alt={activeGroup.author_name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <span id={storyTitleId} className="text-[13px] font-semibold text-white">
                  {activeGroup.author_handle}
                </span>
                {activeSlide.audience === "close_friends" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#30D158] px-2 py-0.5 text-[10px] font-semibold text-white">
                    <Star className="h-2.5 w-2.5 fill-white" />
                    Close Friends
                  </span>
                )}
              </Link>
              <button
                type="button"
                autoFocus
                onClick={() => setActiveGroupIdx(null)}
                aria-label="Close story"
                className="rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 9:16 Real Photo + Tap zones (fits cleanly above fold on all mobile heights) */}
            <div className="relative aspect-[9/14] max-h-[74dvh] w-full bg-[#18191E]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeSlide.media_url}
                alt={activeSlide.caption || activeGroup.author_name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label="Previous story"
                onClick={() => stepStory(-1)}
                className="absolute inset-y-14 left-0 w-1/3"
              />
              <button
                type="button"
                aria-label="Next story"
                onClick={() => stepStory(1)}
                className="absolute inset-y-14 right-0 w-2/3"
              />

              {/* Caption overlay */}
              {activeSlide.caption && (
                <div className="pointer-events-none absolute right-4 bottom-20 left-4 rounded-xl bg-black/55 px-3.5 py-2 text-center text-[14px] text-white backdrop-blur-sm">
                  {activeSlide.caption}
                </div>
              )}

              {/* Bottom Reply + Heart Bar (for persona stories) */}
              {activeGroup.author_type === "persona" && (
                <form
                  onSubmit={submitStoryReply}
                  className="absolute right-3 bottom-3 left-3 z-20 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={storyReply}
                    onChange={(e) => setStoryReply(e.target.value)}
                    placeholder={`Reply to ${activeGroup.author_handle}...`}
                    maxLength={240}
                    className="flex-1 rounded-full border border-white/25 bg-black/50 px-4 py-2 text-[14px] text-white placeholder-white/70 backdrop-blur-md focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void toggleStoryLike()}
                    aria-label="Like story"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md"
                  >
                    <Heart
                      className={`h-5 w-5 ${
                        activeSlide.liked_by_user ? "fill-[#FF3B30] text-[#FF3B30]" : "text-white"
                      }`}
                    />
                  </button>
                  {storyReply.trim() && (
                    <button
                      type="submit"
                      disabled={sendingStoryReply}
                      className="rounded-full bg-[#5E5CE6] px-3.5 py-2 text-[13px] font-semibold text-white"
                    >
                      Send
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        )}
      </dialog>

      {/* Create Your Story Native <dialog> */}
      <dialog
        ref={createStoryDialogRef}
        onClose={() => setCreateStoryOpen(false)}
        className="circle-dialog w-full"
      >
        {createStoryOpen && (
          <form
            onSubmit={publishStory}
            className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#18191E] p-4"
          >
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-[16px] font-semibold text-white">Add to Story</h2>
              <button
                type="button"
                onClick={() => setCreateStoryOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {newStoryPhoto ? (
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-[#0D0E12]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={newStoryPhoto}
                  alt="Story preview"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setNewStoryPhoto(null)}
                  className="absolute top-2 right-2 rounded-full bg-black/70 p-1.5 text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#0D0E12] text-[#8E8E93] hover:text-white">
                <ImagePlus className="h-7 w-7" />
                <span className="text-[14px]">Upload a photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleStoryFile}
                  className="hidden"
                />
              </label>
            )}

            {/* Quick real campus photo presets */}
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
              {[
                "/photos/coffee-quad.jpg",
                "/photos/campus-quad-sun.jpg",
                "/photos/sunset-rooftop.jpg",
                "/photos/library-stacks.jpg",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNewStoryPhoto(preset)}
                  className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${
                    newStoryPhoto === preset ? "border-[#5E5CE6]" : "border-white/[0.08]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preset} alt="Preset" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>

            <input
              type="text"
              value={newStoryCaption}
              onChange={(e) => setNewStoryCaption(e.target.value)}
              placeholder="Add a short caption..."
              maxLength={140}
              className="mt-3 w-full rounded-xl bg-[#0D0E12] px-3.5 py-2.5 text-[14px] text-white placeholder-[#8E8E93] focus:outline-none"
            />

            <div className="mt-3 flex items-center justify-between">
              <div className="flex rounded-full bg-[#262930] p-0.5 text-[12px]">
                <button
                  type="button"
                  onClick={() => setNewStoryAudience("campus")}
                  className={`rounded-full px-3 py-1 ${
                    newStoryAudience === "campus" ? "bg-[#5E5CE6] text-white" : "text-[#8E8E93]"
                  }`}
                >
                  Your Story
                </button>
                <button
                  type="button"
                  onClick={() => setNewStoryAudience("close_friends")}
                  className={`rounded-full px-3 py-1 ${
                    newStoryAudience === "close_friends"
                      ? "bg-[#30D158] text-white"
                      : "text-[#8E8E93]"
                  }`}
                >
                  Close Friends
                </button>
              </div>
              <button
                type="submit"
                disabled={!newStoryPhoto || postingStory}
                className="rounded-full bg-[#5E5CE6] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {postingStory ? "Sharing..." : "Share"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </AppShell>
  );
}
