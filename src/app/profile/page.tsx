"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, ChevronDown, Grid3X3, Menu, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/components/RealtimeProvider";
import { PostCard, type FeedPostItem } from "@/components/PostCard";

interface ScheduleRow {
  id: string;
  persona_id: string;
  persona_name: string;
  persona_avatar: string | null;
  event_type: string;
  title: string;
  scheduled_day: number;
  slot_label: string;
  status: string;
  has_conflict: boolean;
}

export default function ProfilePage() {
  const { me, refreshMe } = useRealtime();
  const [userPosts, setUserPosts] = useState<FeedPostItem[]>([]);
  const [savedPosts, setSavedPosts] = useState<FeedPostItem[]>([]);
  const [activeTab, setActiveTab] = useState<"posts" | "saved">("posts");
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [selectedPost, setSelectedPost] = useState<FeedPostItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editDialogRef = useRef<HTMLDialogElement | null>(null);
  const schedDialogRef = useRef<HTMLDialogElement | null>(null);
  const postDialogRef = useRef<HTMLDialogElement | null>(null);
  const editTitleId = useId();
  const schedTitleId = useId();
  const postTitleId = useId();

  const loadData = useCallback(async () => {
    const [postsRes, savedRes, schedRes] = await Promise.all([
      fetch("/api/v1/feed?author=user&limit=50", { cache: "no-store" }),
      fetch("/api/v1/feed?saved=true&limit=50", { cache: "no-store" }),
      fetch("/api/v1/world-events", { cache: "no-store" }),
    ]);
    if (postsRes.ok) {
      const p = (await postsRes.json()) as { posts: FeedPostItem[] };
      setUserPosts(p.posts || []);
    }
    if (savedRes.ok) {
      const sp = (await savedRes.json()) as { posts: FeedPostItem[] };
      setSavedPosts(sp.posts || []);
    }
    if (schedRes.ok) {
      const s = (await schedRes.json()) as { events: ScheduleRow[] };
      setSchedule(s.events || []);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void refreshMe();
  }, [loadData, refreshMe]);

  useEffect(() => {
    if (me?.user) {
      setEditName(me.user.display_name);
      setEditBio(me.user.bio || "");
      setEditAvatar(me.user.avatar_url || null);
    }
  }, [me?.user]);

  useEffect(() => {
    const d = editDialogRef.current;
    if (!d) return;
    if (editOpen && !d.open) d.showModal();
    else if (!editOpen && d.open) d.close();
  }, [editOpen]);

  useEffect(() => {
    const d = schedDialogRef.current;
    if (!d) return;
    if (scheduleOpen && !d.open) d.showModal();
    else if (!scheduleOpen && d.open) d.close();
  }, [scheduleOpen]);

  useEffect(() => {
    const d = postDialogRef.current;
    if (!d) return;
    if (selectedPost && !d.open) d.showModal();
    else if (!selectedPost && d.open) d.close();
  }, [selectedPost]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editName.trim(),
          bio: editBio.trim(),
          avatar_url: editAvatar,
        }),
      });
      if (res.ok) {
        await refreshMe();
        setEditOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setEditAvatar(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const user = me?.user;
  const username = (user?.handle || "@you").replace(/^@/, "");
  const initial = (user?.display_name || "U").slice(0, 1).toUpperCase();
  const followersCount = me?.followers_count ?? 0;
  const followingCount = me?.following_count ?? 0;
  const upcomingInvites = schedule.filter(
    (s) => s.event_type === "invite" && (s.status === "pending" || s.status === "accepted")
  );
  const gridPosts = activeTab === "posts" ? userPosts : savedPosts;

  return (
    <AppShell>
      {/* Profile Header */}
      <header className="sticky top-0 z-20 flex h-[50px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12]/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-1">
          <h1 className="text-[18px] font-bold tracking-[-0.02em] text-white">{username}</h1>
          <ChevronDown className="h-4 w-4 text-white" />
        </div>

        <Link
          href="/settings"
          aria-label="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/[0.06]"
        >
          <Menu className="h-6 w-6" strokeWidth={1.9} />
        </Link>
      </header>

      {/* Top Profile Identity Block (REAL 0/0/0 Cold-Start Counters — NO fake 22/22 or verified badge!) */}
      <section className="px-4 pt-4 pb-4">
        <div className="flex items-center gap-6">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-[#262930]">
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt={user.display_name}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
                {initial}
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="text-[15px] font-semibold text-white">
              {user?.display_name || "New Student"}
            </div>

            <div className="mt-2.5 flex items-center justify-between pr-2">
              <div className="text-center">
                <div className="text-[16px] font-bold tabular-nums text-white">
                  {userPosts.length}
                </div>
                <div className="text-[12px] text-[#8E8E93]">posts</div>
              </div>
              <Link href="/crew" className="text-center">
                <div className="text-[16px] font-bold tabular-nums text-white">
                  {followersCount}
                </div>
                <div className="text-[12px] text-[#8E8E93]">followers</div>
              </Link>
              <Link href="/crew" className="text-center">
                <div className="text-[16px] font-bold tabular-nums text-white">
                  {followingCount}
                </div>
                <div className="text-[12px] text-[#8E8E93]">following</div>
              </Link>
            </div>
          </div>
        </div>

        {user?.bio && (
          <p className="mt-3 text-[14px] leading-[1.4] text-white/95">{user.bio}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="h-[34px] rounded-lg bg-[#262930] text-[14px] font-semibold text-white transition active:scale-[0.98]"
          >
            Edit Profile
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="h-[34px] rounded-lg bg-[#262930] text-[14px] font-semibold text-white transition active:scale-[0.98]"
          >
            Schedule{upcomingInvites.length > 0 ? ` (${upcomingInvites.length})` : ""}
          </button>
        </div>
      </section>

      {/* Two Instagram Tabs: Posts Grid | Saved Bookmarks */}
      <div className="grid grid-cols-2 border-y border-white/[0.08]">
        <button
          type="button"
          onClick={() => setActiveTab("posts")}
          aria-label="Your Posts"
          className={`flex items-center justify-center py-2.5 transition ${
            activeTab === "posts"
              ? "border-b-2 border-white text-white"
              : "text-[#8E8E93] hover:text-white"
          }`}
        >
          <Grid3X3 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("saved")}
          aria-label="Saved Posts"
          className={`flex items-center justify-center py-2.5 transition ${
            activeTab === "saved"
              ? "border-b-2 border-white text-white"
              : "text-[#8E8E93] hover:text-white"
          }`}
        >
          <Bookmark className="h-5 w-5" />
        </button>
      </div>

      {/* 3-Column Post / Saved Grid */}
      {gridPosts.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[15px] font-semibold text-white">
            {activeTab === "posts" ? "Share your first post" : "No saved posts yet"}
          </p>
          <p className="mt-1 text-[13px] text-[#8E8E93]">
            {activeTab === "posts"
              ? "Photos and moments you post appear on your campus profile."
              : "Tap the bookmark icon on any post in the feed to save it here."}
          </p>
          {activeTab === "posts" && (
            <Link
              href="/compose"
              className="mt-4 inline-flex rounded-full bg-[#5E5CE6] px-5 py-2 text-[14px] font-semibold text-white"
            >
              New Post
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[2px]">
          {gridPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setSelectedPost(post)}
              className="relative aspect-square w-full overflow-hidden bg-[#26282C] text-left"
            >
              {post.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.image_url}
                  alt={post.body}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-2.5 text-center">
                  <span className="line-clamp-5 text-[12px] leading-snug font-medium text-white">
                    {post.body}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Edit Profile <dialog> */}
      <dialog
        ref={editDialogRef}
        aria-labelledby={editTitleId}
        onClose={() => setEditOpen(false)}
        className="circle-dialog w-full"
      >
        <form
          onSubmit={handleSaveProfile}
          className="rounded-2xl border border-white/[0.08] bg-[#18191E] p-5"
        >
          <div className="flex items-center justify-between">
            <h1 id={editTitleId} className="text-[16px] font-semibold text-white">
              Edit Profile
            </h1>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              aria-label="Close"
              className="rounded-full p-1 text-[#8E8E93] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-full bg-[#262930]">
              {editAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={editAvatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-semibold">
                  {initial}
                </div>
              )}
            </div>
            <label className="cursor-pointer rounded-full bg-[#262930] px-3.5 py-1.5 text-[13px] font-semibold text-white">
              Change Photo
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-[12px] text-[#8E8E93]">Display Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#0D0E12] px-3 py-2 text-[14px] text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[12px] text-[#8E8E93]">Bio</label>
              <textarea
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                className="mt-1 w-full resize-none rounded-xl border border-white/[0.08] bg-[#0D0E12] px-3 py-2 text-[14px] text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setEditOpen(false)}
              className="flex-1 rounded-full bg-[#262930] py-2.5 text-[14px] font-semibold text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-full bg-[#5E5CE6] py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </dialog>

      {/* Campus Schedule <dialog> */}
      <dialog
        ref={schedDialogRef}
        aria-labelledby={schedTitleId}
        onClose={() => setScheduleOpen(false)}
        className="circle-dialog w-full"
      >
        <div className="circle-scroll max-h-[80dvh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#18191E] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 id={schedTitleId} className="text-[16px] font-semibold text-white">
                Campus Schedule
              </h1>
              {user && (
                <p className="text-[12px] text-[#8E8E93]">
                  Day {user.current_day} · {me?.slot_meta?.label || user.current_slot}
                </p>
              )}
            </div>
            <button
              type="button"
              autoFocus
              onClick={() => setScheduleOpen(false)}
              aria-label="Close schedule"
              className="rounded-full p-1 text-[#8E8E93] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 divide-y divide-white/[0.08]">
            {schedule.filter((s) => s.event_type !== "spontaneous_ping").length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[#8E8E93]">
                No campus plans yet. Get to know people first and invites will show up naturally.
              </p>
            ) : (
              schedule
                .filter((s) => s.event_type !== "spontaneous_ping")
                .map((ev) => (
                  <Link
                    key={ev.id}
                    href={`/dms/${ev.persona_id}`}
                    onClick={() => setScheduleOpen(false)}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {ev.persona_avatar && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ev.persona_avatar}
                          alt={ev.persona_name}
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-white">
                          {ev.title}
                        </div>
                        <div className="text-[12px] text-[#8E8E93]">
                          {ev.persona_name} · Day {ev.scheduled_day} ({ev.slot_label})
                          {ev.has_conflict ? " · Conflict" : ""}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 text-[12px] font-medium capitalize text-[#8E8E93]">
                      {ev.status}
                    </span>
                  </Link>
                ))
            )}
          </div>

          <div className="mt-4">
            <Link
              href="/activity"
              onClick={() => setScheduleOpen(false)}
              className="block w-full rounded-full bg-[#5E5CE6] py-2.5 text-center text-[14px] font-semibold text-white"
            >
              Manage in Activity
            </Link>
          </div>
        </div>
      </dialog>

      {/* Post Detail <dialog> */}
      <dialog
        ref={postDialogRef}
        aria-labelledby={postTitleId}
        onClose={() => setSelectedPost(null)}
        className="circle-dialog w-full"
      >
        {selectedPost && (
          <div className="circle-scroll max-h-[85dvh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0D0E12]">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <h1 id={postTitleId} className="text-[15px] font-semibold text-white">
                Post
              </h1>
              <button
                type="button"
                autoFocus
                onClick={() => setSelectedPost(null)}
                aria-label="Close post"
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <PostCard
              post={selectedPost}
              onLike={async (id) => {
                await fetch(`/api/v1/posts/${id}/like`, { method: "POST" });
                void loadData();
              }}
              onSave={async (id) => {
                await fetch(`/api/v1/posts/${id}/save`, { method: "POST" });
                void loadData();
              }}
            />
          </div>
        )}
      </dialog>
    </AppShell>
  );
}
