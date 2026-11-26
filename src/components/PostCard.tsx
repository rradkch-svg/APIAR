"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Star,
  X,
} from "lucide-react";

export interface FeedCommentNode {
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
  replies?: FeedCommentNode[];
}

export interface FeedPostItem {
  id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  author_name: string;
  author_handle: string;
  author_avatar: string | null;
  author_accent: string;
  author_clique?: string | null;
  body: string;
  image_url: string | null;
  media_urls?: string[];
  location_tag?: string | null;
  audience?: string;
  liked_by_user?: boolean;
  saved_by_user?: boolean;
  user_follows_author?: boolean;
  liked_by_handles?: string[];
  image_caption_ai: string | null;
  likes_count: number;
  views_count: number;
  created_at: string;
  comments: FeedCommentNode[];
}

export interface ShareRecipient {
  id: string;
  display_name: string;
  handle: string;
  avatar_url: string | null;
}

export function formatShortTime(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function PostCard({
  post,
  onLike,
  onSave,
  onComment,
  onFollow,
  shareRecipients = [],
}: {
  post: FeedPostItem;
  onLike: (postId: string) => void;
  onSave?: (postId: string) => void;
  onComment?: (postId: string, body: string, parentCommentId?: string | null) => Promise<void>;
  onFollow?: (personaId: string) => void;
  shareRecipients?: ShareRecipient[];
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [heartBurst, setHeartBurst] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; handle: string } | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const shareDialogRef = useRef<HTMLDialogElement | null>(null);
  const lastTapRef = useRef<number>(0);

  const liked = Boolean(post.liked_by_user);
  const saved = Boolean(post.saved_by_user);
  const slides =
    post.media_urls && post.media_urls.length > 0
      ? post.media_urls
      : post.image_url
        ? [post.image_url]
        : [];
  const currentSlide = slides[Math.min(slideIdx, Math.max(0, slides.length - 1))] || null;

  const handleClean = post.author_handle.replace(/^@/, "");
  const totalComments = post.comments.reduce(
    (sum, c) => sum + 1 + (c.replies?.length || 0),
    0
  );

  const profileHref = post.author_persona_id
    ? `/crew?inspect=${post.author_persona_id}`
    : "/profile";

  const handleImageTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      setHeartBurst(true);
      setTimeout(() => setHeartBurst(false), 750);
      if (!liked) onLike(post.id);
    }
    lastTapRef.current = now;
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentInput.trim();
    if (!text || !onComment || submittingComment) return;
    setSubmittingComment(true);
    try {
      await onComment(post.id, text, replyingTo?.id ?? null);
      setCommentInput("");
      setReplyingTo(null);
      setCommentsOpen(true);
    } finally {
      setSubmittingComment(false);
    }
  };

  const openShareModal = () => {
    setSentTo(null);
    setShareNote("");
    setShareOpen(true);
    setTimeout(() => shareDialogRef.current?.showModal(), 0);
  };

  const closeShareModal = () => {
    shareDialogRef.current?.close();
    setShareOpen(false);
  };

  const sendPostToPersona = async (personaId: string) => {
    setSentTo(personaId);
    await fetch(`/api/v1/posts/${post.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: personaId, note: shareNote.trim() }),
    });
    setTimeout(() => closeShareModal(), 600);
  };

  return (
    <article className="border-b border-white/[0.08] bg-[#0D0E12] pb-3.5">
      {/* Edge-to-edge Post Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={profileHref} className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#262930]">
            {post.author_avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.author_avatar}
                alt={post.author_name}
                className="h-full w-full rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">
                {post.author_name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={profileHref}
                className="truncate text-[14px] font-semibold tracking-[-0.01em] text-white"
              >
                {handleClean}
              </Link>
              {post.audience === "close_friends" && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#30D158] text-white">
                  <Star className="h-2.5 w-2.5 fill-white" />
                </span>
              )}
              {post.author_type === "persona" &&
                post.author_persona_id &&
                !post.user_follows_author &&
                onFollow && (
                  <button
                    type="button"
                    onClick={() => onFollow(post.author_persona_id!)}
                    className="text-[12px] font-semibold text-[#5E5CE6] hover:text-white"
                  >
                    Follow
                  </button>
                )}
            </div>
            {post.location_tag && (
              <div className="truncate text-[11px] leading-tight text-[#8E8E93]">
                {post.location_tag}
              </div>
            )}
          </div>
        </div>

        <Link
          href={post.author_persona_id ? `/dms/${post.author_persona_id}` : "/profile"}
          aria-label="Open conversation"
          className="rounded-full p-1 text-[#8E8E93] hover:text-white"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Link>
      </div>

      {/* Full-bleed Photo / Carousel OR Minimalist Text-Only Frame */}
      {currentSlide ? (
        <div
          onClick={handleImageTap}
          className="relative w-full select-none bg-[#18191E]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSlide}
            alt={post.image_caption_ai || "Post photo"}
            className="aspect-[4/4.3] w-full object-cover"
          />

          {/* Double-tap heart burst */}
          {heartBurst && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Heart className="h-20 w-20 animate-ping fill-white text-white opacity-90" />
            </div>
          )}

          {/* Carousel counter + prev/next controls */}
          {slides.length > 1 && (
            <>
              <span className="absolute top-3 right-3 rounded-full bg-black/65 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                {slideIdx + 1}/{slides.length}
              </span>
              {slideIdx > 0 && (
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlideIdx((i) => Math.max(0, i - 1));
                  }}
                  className="absolute top-1/2 left-2.5 -translate-y-1/2 rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {slideIdx < slides.length - 1 && (
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlideIdx((i) => Math.min(slides.length - 1, i + 1));
                  }}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="w-full border-y border-white/[0.05] bg-[#18191E] px-5 py-9">
          <p className="whitespace-pre-wrap text-[16px] leading-[1.45] font-normal text-white">
            {post.body}
          </p>
        </div>
      )}

      {/* Action Bar: Heart, Comment, Share on Left | Carousel Dots Center | Bookmark Right */}
      <div className="relative flex items-center justify-between px-3.5 pt-2.5 pb-1.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onLike(post.id)}
            aria-label={liked ? "Unlike post" : "Like post"}
            className="flex items-center gap-1.5 text-white transition active:scale-90"
          >
            <Heart
              className={`h-[22px] w-[22px] ${
                liked ? "fill-[#FF3B30] text-[#FF3B30]" : "text-white"
              }`}
              strokeWidth={1.9}
            />
            {post.likes_count > 0 && (
              <span className="text-[14px] font-medium tabular-nums text-white">
                {post.likes_count}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setCommentsOpen((v) => !v)}
            aria-label="Toggle comments"
            className="flex items-center gap-1.5 text-white transition active:scale-90"
          >
            <MessageCircle className="h-[22px] w-[22px] text-white" strokeWidth={1.9} />
            {totalComments > 0 && (
              <span className="text-[14px] font-medium tabular-nums text-white">
                {totalComments}
              </span>
            )}
          </button>

          {shareRecipients.length > 0 && (
            <button
              type="button"
              onClick={openShareModal}
              aria-label="Share post to DM"
              className="text-white transition active:scale-90"
            >
              <Send className="h-[20px] w-[20px]" strokeWidth={1.9} />
            </button>
          )}
        </div>

        {slides.length > 1 && (
          <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
            {slides.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === slideIdx ? "bg-[#5E5CE6]" : "bg-white/25"
                }`}
              />
            ))}
          </div>
        )}

        {onSave && (
          <button
            type="button"
            onClick={() => onSave(post.id)}
            aria-label={saved ? "Remove bookmark" : "Save post"}
            className="text-white transition active:scale-90"
          >
            <Bookmark
              className={`h-[21px] w-[21px] ${saved ? "fill-white text-white" : "text-white"}`}
              strokeWidth={1.9}
            />
          </button>
        )}
      </div>

      {/* Real Relational Likes Line */}
      {post.liked_by_handles && post.liked_by_handles.length > 0 && (
        <div className="px-3.5 pb-1 text-[13px] text-white/90">
          Liked by <span className="font-semibold">{post.liked_by_handles[0]}</span>
          {post.likes_count > 1 && (
            <>
              {" "}
              and <span className="font-semibold">{post.likes_count - 1} others</span>
            </>
          )}
        </div>
      )}

      {/* Inline Caption (for photo posts) */}
      {currentSlide && (
        <div className="px-3.5 text-[14px] leading-[1.4] text-white">
          <Link href={profileHref} className="mr-1.5 font-semibold text-white">
            {handleClean}
          </Link>
          <span className="text-white/95">{post.body}</span>
        </div>
      )}

      {/* Collapsed "View all comments" trigger */}
      {totalComments > 0 && (
        <div className="px-3.5 pt-1">
          <button
            type="button"
            onClick={() => setCommentsOpen((v) => !v)}
            className="text-[13px] text-[#8E8E93] hover:text-white"
          >
            {commentsOpen
              ? "Hide comments"
              : `View all ${totalComments} ${totalComments === 1 ? "comment" : "comments"}`}
          </button>
        </div>
      )}

      {/* Subtle Timestamp */}
      <div className="px-3.5 pt-1 text-[12px] text-[#8E8E93]">
        {formatShortTime(post.created_at)}
      </div>

      {/* Expanded Threaded Comments + User Comment/Reply Composer */}
      {commentsOpen && (
        <div className="mt-2.5 space-y-3 border-t border-white/[0.08] px-3.5 pt-3">
          {post.comments.length === 0 ? (
            <p className="text-[13px] text-[#8E8E93]">No comments yet. Start the thread.</p>
          ) : (
            post.comments.map((c) => {
              const cHandle = c.author_handle.replace(/^@/, "");
              return (
                <div key={c.id} className="space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <Link
                      href={c.author_persona_id ? `/crew?inspect=${c.author_persona_id}` : "/profile"}
                      className="mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#262930]"
                    >
                      {c.author_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.author_avatar}
                          alt={c.author_name}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold">
                          {c.author_name.slice(0, 1)}
                        </div>
                      )}
                    </Link>
                    <div className="min-w-0 flex-1 text-[14px] leading-[1.35]">
                      <Link
                        href={
                          c.author_persona_id ? `/crew?inspect=${c.author_persona_id}` : "/profile"
                        }
                        className="mr-1.5 font-semibold text-white hover:underline"
                      >
                        {cHandle}
                      </Link>
                      <span className="text-white/95">{c.body}</span>
                      <div className="mt-0.5 flex items-center gap-3 text-[12px] text-[#8E8E93]">
                        <span>{formatShortTime(c.created_at)}</span>
                        {onComment && (
                          <button
                            type="button"
                            onClick={() => setReplyingTo({ id: c.id, handle: cHandle })}
                            className="font-semibold text-[#8E8E93] hover:text-white"
                          >
                            Reply
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {c.replies && c.replies.length > 0 && (
                    <div className="ml-9 space-y-2.5 border-l border-white/[0.08] pl-3">
                      {c.replies.map((reply) => {
                        const rHandle = reply.author_handle.replace(/^@/, "");
                        return (
                          <div key={reply.id} className="flex items-start gap-2">
                            <Link
                              href={
                                reply.author_persona_id
                                  ? `/crew?inspect=${reply.author_persona_id}`
                                  : "/profile"
                              }
                              className="mt-0.5 h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[#262930]"
                            >
                              {reply.author_avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={reply.author_avatar}
                                  alt={reply.author_name}
                                  className="h-full w-full rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold">
                                  {reply.author_name.slice(0, 1)}
                                </div>
                              )}
                            </Link>
                            <div className="min-w-0 flex-1 text-[14px] leading-[1.35]">
                              <Link
                                href={
                                  reply.author_persona_id
                                    ? `/crew?inspect=${reply.author_persona_id}`
                                    : "/profile"
                                }
                                className="mr-1.5 font-semibold text-white hover:underline"
                              >
                                {rHandle}
                              </Link>
                              <span className="text-white/90">{reply.body}</span>
                              <div className="mt-0.5 text-[12px] text-[#8E8E93]">
                                {formatShortTime(reply.created_at)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* User Comment & Reply Input */}
          {onComment && (
            <form onSubmit={submitComment} className="pt-1">
              {replyingTo && (
                <div className="mb-1.5 flex items-center justify-between rounded-lg bg-[#18191E] px-2.5 py-1 text-[12px] text-[#8E8E93]">
                  <span>Replying to @{replyingTo.handle}</span>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="text-white"
                    aria-label="Cancel reply"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-full bg-[#18191E] px-3.5 py-2">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder={replyingTo ? `Reply to @${replyingTo.handle}...` : "Add a comment..."}
                  maxLength={300}
                  className="flex-1 bg-transparent text-[14px] text-white placeholder-[#8E8E93] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!commentInput.trim() || submittingComment}
                  className="text-[13px] font-semibold text-[#5E5CE6] disabled:opacity-40"
                >
                  Post
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Share-to-DM Native Dialog */}
      <dialog
        ref={shareDialogRef}
        onCancel={closeShareModal}
        onClick={(e) => {
          if (e.target === shareDialogRef.current) closeShareModal();
        }}
        className="m-auto w-full max-w-[390px] rounded-[24px] border border-white/[0.1] bg-[#18191E] p-0 text-white"
      >
        {shareOpen && (
          <div className="p-4">
            <div className="flex items-center justify-between pb-3">
              <h3 className="text-[16px] font-semibold">Share to DM</h3>
              <button
                type="button"
                onClick={closeShareModal}
                aria-label="Close share sheet"
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="text"
              value={shareNote}
              onChange={(e) => setShareNote(e.target.value)}
              placeholder="Write a message (optional)..."
              maxLength={200}
              className="mb-3 w-full rounded-xl bg-[#0D0E12] px-3.5 py-2.5 text-[14px] text-white placeholder-[#8E8E93] focus:outline-none"
            />
            <div className="max-h-64 divide-y divide-white/[0.06] overflow-y-auto">
              {shareRecipients.slice(0, 12).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-[#262930]">
                      {p.avatar_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.avatar_url}
                          alt={p.display_name}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div>
                      <div className="text-[14px] font-medium text-white">{p.display_name}</div>
                      <div className="text-[12px] text-[#8E8E93]">{p.handle}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void sendPostToPersona(p.id)}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                      sentTo === p.id
                        ? "bg-[#262930] text-[#8E8E93]"
                        : "bg-[#5E5CE6] text-white"
                    }`}
                  >
                    {sentTo === p.id ? "Sent" : "Send"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </article>
  );
}
