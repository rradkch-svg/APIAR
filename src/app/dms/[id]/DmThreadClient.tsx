"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowUp,
  ChevronLeft,
  ImagePlus,
  MoreHorizontal,
  Reply,
  SmilePlus,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { VoiceNotePlayer } from "@/components/VoiceNotePlayer";
import { PhotoMessageCard } from "@/components/PhotoMessageCard";
import { VideoNotePlayer } from "@/components/VideoNotePlayer";
import { EventInviteCard } from "@/components/EventInviteCard";
import { useRealtime } from "@/components/RealtimeProvider";
import type { MediaTierInfo } from "@/lib/media/tiers";

interface DmMessageItem {
  id: string;
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
}

interface ThreadPayload {
  persona: {
    id: string;
    display_name: string;
    handle: string;
    avatar_url: string | null;
    accent_color: string;
    bio: string;
    voice_profile: Record<string, unknown>;
    is_online: boolean;
  };
  state: {
    affinity: number;
    trust: number;
    romantic_tension: number;
    current_mood: string;
    internal_thought: string;
    relationship_stage: string;
    user_follows?: boolean;
    persona_follows_back?: boolean;
  };
  media_tier: MediaTierInfo;
  messages: DmMessageItem[];
}

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "💀"];

export default function DmChatPage() {
  const params = useParams<{ id: string }>();
  const personaId = params.id;
  const { subscribe, typingPersonas, refreshMe } = useRealtime();

  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<DmMessageItem | null>(null);
  const [reactPickerMsgId, setReactPickerMsgId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const menuDialogRef = useRef<HTMLDialogElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const menuTitleId = useId();

  const loadThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/dms/${personaId}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as ThreadPayload;
        setThread(data);
        void refreshMe();
      }
    } finally {
      setLoading(false);
    }
  }, [personaId, refreshMe]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    const dialog = menuDialogRef.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    else if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);

  useEffect(() => {
    return subscribe((evName, data) => {
      if (evName === "dm:bubble" && String(data.persona_id) === personaId) {
        const incoming = data.message as DmMessageItem | undefined;
        const stateUpdate = data.state_update as ThreadPayload["state"] | undefined;
        if (incoming) {
          setThread((prev) => {
            if (!prev) return prev;
            if (prev.messages.some((m) => m.id === incoming.id)) return prev;
            return {
              ...prev,
              messages: [...prev.messages, incoming],
              state: stateUpdate ? { ...prev.state, ...stateUpdate } : prev.state,
            };
          });
        }
      } else if (evName === "dm:read" && String(data.persona_id) === personaId) {
        const readAt = String(data.read_at || new Date().toISOString());
        setThread((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.sender_type === "user" && !m.read_at ? { ...m, read_at: readAt } : m
                ),
              }
            : prev
        );
      } else if (evName === "dm:reaction" && String(data.persona_id) === personaId) {
        const mid = String(data.message_id || "");
        const reaction = data.reaction ? String(data.reaction) : null;
        setThread((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) => (m.id === mid ? { ...m, reaction } : m)),
              }
            : prev
        );
      } else if (evName === "world:update") {
        void loadThread();
      }
    });
  }, [personaId, subscribe, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length, typingPersonas[personaId]]);

  const handlePhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPendingPhoto(reader.result);
    };
    reader.readAsDataURL(file);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const reactToMessage = async (messageId: string, emoji: string) => {
    setReactPickerMsgId(null);
    setThread((prev) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === messageId ? { ...m, reaction: m.reaction === emoji ? null : emoji } : m
            ),
          }
        : prev
    );
    await fetch(`/api/v1/dms/${personaId}/messages/${messageId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
  };

  const sendMessage = async (
    messageType: "text" | "image" | "screenshot_alert",
    overrideBody?: string
  ) => {
    const isPhoto = messageType === "image" || (messageType === "text" && Boolean(pendingPhoto));
    const finalType = isPhoto ? "image" : messageType;
    const content = overrideBody ?? text.trim();
    if (finalType === "text" && !content) return;
    if (finalType === "image" && !pendingPhoto) return;
    if (sending) return;

    setError(null);
    setSending(true);
    const photoPayload = pendingPhoto;
    const replyId = replyTarget?.id ?? null;

    try {
      const res = await fetch(`/api/v1/dms/${personaId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: content,
          message_type: finalType,
          media_url: finalType === "image" ? photoPayload : undefined,
          reply_to_message_id: replyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send message.");
        return;
      }

      if (finalType === "text" || finalType === "image") {
        setText("");
        setPendingPhoto(null);
        setReplyTarget(null);
      }

      if (data.user_message) {
        setThread((prev) => {
          if (!prev) return prev;
          if (prev.messages.some((m) => m.id === data.user_message.id)) return prev;
          return {
            ...prev,
            messages: [...prev.messages, data.user_message],
            state: data.state ? { ...prev.state, ...data.state } : prev.state,
            media_tier: data.media_tier || prev.media_tier,
          };
        });
      }
      void refreshMe();
    } catch {
      setError("Network error while sending message.");
    } finally {
      setSending(false);
    }
  };

  const typingActivity = typingPersonas[personaId];
  const messages = thread?.messages || [];
  let lastUserMsgIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === "user") {
      lastUserMsgIdx = i;
      break;
    }
  }

  return (
    <AppShell hideBottomNav>
      <div className="flex h-dvh flex-col bg-[#0D0E12]">
        {/* Clean Instagram DM Header */}
        <header className="sticky top-0 z-20 flex h-[54px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12]/95 px-2.5 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/dms"
              aria-label="Back to messages"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
            >
              <ChevronLeft className="h-6 w-6" />
            </Link>

            {thread && (
              <Link
                href={`/crew?inspect=${thread.persona.id}`}
                className="flex min-w-0 items-center gap-2.5"
              >
                <div className="relative h-8 w-8 shrink-0">
                  <div className="h-full w-full overflow-hidden rounded-full bg-[#262930]">
                    {thread.persona.avatar_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thread.persona.avatar_url}
                        alt={thread.persona.display_name}
                        className="h-full w-full rounded-full object-cover"
                      />
                    )}
                  </div>
                  {thread.persona.is_online && (
                    <span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-[#0D0E12] bg-[#30D158]" />
                  )}
                </div>

                <div className="min-w-0">
                  <h1 className="truncate text-[14px] font-semibold leading-tight text-white">
                    {thread.persona.display_name}
                  </h1>
                  <div className="truncate text-[12px] text-[#8E8E93]">
                    {thread.persona.is_online ? "Active now" : thread.persona.handle}
                  </div>
                </div>
              </Link>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Chat options"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/[0.06]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </header>

        {/* Instagram DM Message Stream */}
        <div
          className="circle-scroll flex-1 overflow-y-auto px-3 py-4"
          onClick={() => {
            if (reactPickerMsgId) setReactPickerMsgId(null);
          }}
        >
          {loading ? (
            <div className="py-12 text-center text-[13px] text-[#8E8E93]">Loading...</div>
          ) : !thread ? (
            <div className="py-12 text-center text-[13px] text-[#8E8E93]">Chat not found.</div>
          ) : messages.length === 0 ? (
            <div className="mx-auto my-10 flex max-w-[270px] flex-col items-center text-center">
              {thread.persona.avatar_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thread.persona.avatar_url}
                  alt={thread.persona.display_name}
                  className="h-20 w-20 rounded-full object-cover"
                />
              )}
              <div className="mt-3 text-[16px] font-semibold text-white">
                {thread.persona.display_name}
              </div>
              <div className="text-[13px] text-[#8E8E93]">{thread.persona.handle} · Vela</div>
              <p className="mt-2 text-[13px] text-[#8E8E93]">{thread.persona.bio}</p>
              {!thread.state.persona_follows_back && (
                <p className="mt-3 rounded-xl bg-[#18191E] px-3 py-2 text-[12px] text-[#8E8E93]">
                  You don&apos;t know each other yet. Say hi like you would to a classmate on campus.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((msg, idx) => {
                const isUser = msg.sender_type === "user";
                const isSystem =
                  msg.sender_type === "system" || msg.message_type === "screenshot_alert";

                if (isSystem) {
                  return (
                    <div key={msg.id} className="my-3 text-center text-[12px] text-[#8E8E93]">
                      {msg.body}
                    </div>
                  );
                }

                const prev = messages[idx - 1];
                const next = messages[idx + 1];
                const sameAsPrev =
                  prev &&
                  prev.sender_type === msg.sender_type &&
                  prev.message_type !== "screenshot_alert";
                const sameAsNext =
                  next &&
                  next.sender_type === msg.sender_type &&
                  next.message_type !== "screenshot_alert";

                const showPersonaAvatar = !isUser && !sameAsNext;
                const spacingTop = sameAsPrev ? "mt-[2px]" : idx === 0 ? "" : "mt-3.5";

                const userRadius = `${sameAsPrev ? "rounded-tr-[6px]" : "rounded-tr-[20px]"} ${
                  sameAsNext ? "rounded-br-[6px]" : "rounded-br-[20px]"
                } rounded-l-[20px]`;
                const otherRadius = `${sameAsPrev ? "rounded-tl-[6px]" : "rounded-tl-[20px]"} ${
                  sameAsNext ? "rounded-bl-[6px]" : "rounded-bl-[20px]"
                } rounded-r-[20px]`;

                const meta = msg.media_metadata || {};
                const replyPreview = meta.reply_preview ? String(meta.reply_preview) : null;
                const showReceipt = isUser && idx === lastUserMsgIdx;

                return (
                  <div key={msg.id} className={`${spacingTop}`}>
                    <div
                      className={`group relative flex items-end gap-2 ${
                        isUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!isUser && (
                        <div className="h-7 w-7 shrink-0">
                          {showPersonaAvatar && thread.persona.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thread.persona.avatar_url}
                              alt={thread.persona.display_name}
                              className="h-7 w-7 rounded-full object-cover"
                            />
                          )}
                        </div>
                      )}

                      {/* Hover action buttons for user messages (left side) */}
                      {isUser && (
                        <div className="mb-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReactPickerMsgId((cur) => (cur === msg.id ? null : msg.id));
                            }}
                            aria-label="React"
                            className="rounded-full p-1 text-[#8E8E93] hover:text-white"
                          >
                            <SmilePlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyTarget(msg)}
                            aria-label="Reply"
                            className="rounded-full p-1 text-[#8E8E93] hover:text-white"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      <div className={`relative max-w-[78%] ${msg.reaction ? "mb-2.5" : ""}`}>
                        {/* Floating Quick Emoji Picker */}
                        {reactPickerMsgId === msg.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute -top-11 z-30 flex items-center gap-1 rounded-full border border-white/[0.12] bg-[#18191E] px-2 py-1 ${
                              isUser ? "right-0" : "left-0"
                            }`}
                          >
                            {QUICK_REACTIONS.map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => void reactToMessage(msg.id, em)}
                                className="rounded-full p-1 text-[16px] transition hover:scale-125"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}

                        {replyPreview && (
                          <div className="mb-1 rounded-xl border-l-2 border-[#5E5CE6] bg-[#18191E] px-2.5 py-1 text-[12px] text-[#8E8E93]">
                            {replyPreview}
                          </div>
                        )}

                        {msg.message_type === "audio" ? (
                          <VoiceNotePlayer
                            mediaUrl={msg.media_url}
                            transcript={String(meta.transcript || msg.body)}
                            durationSec={Number(meta.duration_sec || 10)}
                            waveform={
                              Array.isArray(meta.waveform) ? (meta.waveform as number[]) : undefined
                            }
                          />
                        ) : msg.message_type === "image" && msg.media_url ? (
                          isUser ? (
                            <div className="overflow-hidden rounded-[20px] bg-[#18191E]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.media_url}
                                alt={msg.body || "Shared photo"}
                                className="max-h-[260px] w-[220px] object-cover"
                              />
                              {msg.body && msg.body !== "Sent a photo" && (
                                <div className="bg-[#5E5CE6] px-3 py-1.5 text-[14px] text-white">
                                  {msg.body}
                                </div>
                              )}
                            </div>
                          ) : (
                            <PhotoMessageCard
                              messageId={msg.id}
                              personaId={thread.persona.id}
                              mediaUrl={msg.media_url}
                              caption={String(meta.visual_prompt || msg.body)}
                              viewOnce={Boolean(meta.view_once)}
                              viewedAt={meta.viewed_at ? String(meta.viewed_at) : null}
                              sceneKind={meta.scene_kind ? String(meta.scene_kind) : "ambient"}
                              onViewedOnce={(mid, viewedAt) => {
                                setThread((prevThread) =>
                                  prevThread
                                    ? {
                                        ...prevThread,
                                        messages: prevThread.messages.map((m) =>
                                          m.id === mid
                                            ? {
                                                ...m,
                                                media_metadata: {
                                                  ...m.media_metadata,
                                                  viewed_at: viewedAt,
                                                },
                                              }
                                            : m
                                        ),
                                      }
                                    : prevThread
                                );
                              }}
                            />
                          )
                        ) : msg.message_type === "video" && msg.media_url ? (
                          <VideoNotePlayer
                            mediaUrl={msg.media_url}
                            audioUrl={meta.audio_url ? String(meta.audio_url) : null}
                            caption={String(meta.transcript || meta.visual_prompt || msg.body)}
                            durationSec={Number(meta.duration_sec || 5)}
                            isLiveVideo={meta.mode === "live_video"}
                          />
                        ) : msg.message_type === "event_invite" && meta.world_event_id ? (
                          <EventInviteCard
                            eventId={String(meta.world_event_id)}
                            title={String(meta.title || "Campus Hangout")}
                            description={String(meta.description || "")}
                            inviteLine={msg.body}
                            scheduledDay={Number(meta.scheduled_day || 1)}
                            scheduledSlot={String(meta.scheduled_slot || "evening")}
                            rewardAffinity={Number(meta.reward_affinity || 8)}
                            status={String(meta.status || "pending")}
                            onStatusChanged={() => void loadThread()}
                          />
                        ) : msg.message_type === "post_share" ? (
                          <div className="w-[220px] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#18191E]">
                            <div className="px-3 py-2 text-[12px] font-semibold text-white">
                              {String(meta.shared_author_handle || "@campus")}
                            </div>
                            {msg.media_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={msg.media_url}
                                alt="Shared post"
                                className="aspect-square w-full object-cover"
                              />
                            )}
                            <div className="px-3 py-2 text-[13px] text-white/90">
                              {String(meta.shared_body || msg.body).slice(0, 90)}
                            </div>
                          </div>
                        ) : (
                          <div
                            onDoubleClick={() => void reactToMessage(msg.id, "❤️")}
                            className={`px-3.5 py-2 text-[15px] leading-[1.35] text-white ${
                              isUser ? `bg-[#5E5CE6] ${userRadius}` : `bg-[#262626] ${otherRadius}`
                            }`}
                          >
                            {msg.message_type === "story_reply" && (
                              <div className="mb-1 text-[11px] text-white/70">Replied to story</div>
                            )}
                            {msg.message_type === "note_reply" && (
                              <div className="mb-1 text-[11px] text-white/70">
                                Replied to note: “{String(meta.note_body || "")}”
                              </div>
                            )}
                            {msg.body}
                          </div>
                        )}

                        {/* Emoji Reaction Pill */}
                        {msg.reaction && (
                          <button
                            type="button"
                            onClick={() => void reactToMessage(msg.id, msg.reaction!)}
                            className={`absolute -bottom-3 flex items-center justify-center rounded-full border border-[#0D0E12] bg-[#262930] px-1.5 py-0.5 text-[12px] ${
                              isUser ? "right-2" : "left-2"
                            }`}
                          >
                            {msg.reaction}
                          </button>
                        )}
                      </div>

                      {/* Hover action buttons for persona messages (right side) */}
                      {!isUser && (
                        <div className="mb-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReactPickerMsgId((cur) => (cur === msg.id ? null : msg.id));
                            }}
                            aria-label="React"
                            className="rounded-full p-1 text-[#8E8E93] hover:text-white"
                          >
                            <SmilePlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyTarget(msg)}
                            aria-label="Reply"
                            className="rounded-full p-1 text-[#8E8E93] hover:text-white"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Real Instagram Read Receipt ("Seen" vs "Sent") */}
                    {showReceipt && (
                      <div className="mt-1 pr-1 text-right text-[11px] text-[#8E8E93]">
                        {msg.read_at ? "Seen" : "Sent"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Clean iOS Typing Indicator */}
          {typingActivity && thread && (
            <div className="mt-3 flex items-end gap-2">
              <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#262930]">
                {thread.persona.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thread.persona.avatar_url}
                    alt={thread.persona.display_name}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 rounded-[20px] bg-[#262626] px-3.5 py-2.5 text-[12px] text-[#8E8E93]">
                <span className="flex items-center gap-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8E8E93]" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8E8E93]" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8E8E93]" />
                </span>
                {typingActivity !== "typing" && (
                  <span className="ml-1">
                    {typingActivity === "recording" ? "recording voice note..." : "sending photo..."}
                  </span>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Clean iOS Pill Composer with Photo Attach + Reply Strip */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(pendingPhoto ? "image" : "text");
          }}
          className="border-t border-white/[0.08] bg-[#0D0E12] px-3 py-2.5"
        >
          {error && (
            <div className="mb-2 rounded-xl bg-[#2A181B] px-3 py-1.5 text-[12px] text-[#FF453A]">
              {error}
            </div>
          )}

          {replyTarget && (
            <div className="mb-2 flex items-center justify-between rounded-xl bg-[#18191E] px-3 py-1.5 text-[12px] text-[#8E8E93]">
              <span className="truncate">
                Replying to: <span className="text-white">{replyTarget.body.slice(0, 60)}</span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="ml-2 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {pendingPhoto && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#18191E] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingPhoto}
                alt="Pending upload"
                className="h-12 w-12 rounded-lg object-cover"
              />
              <span className="flex-1 text-[12px] text-[#8E8E93]">Photo ready to send</span>
              <button
                type="button"
                onClick={() => setPendingPhoto(null)}
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoPick}
            className="hidden"
          />

          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#18191E] py-1.5 pr-1.5 pl-2.5">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              aria-label="Send photo"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8E8E93] hover:text-white"
            >
              <ImagePlus className="h-[19px] w-[19px]" />
            </button>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={pendingPhoto ? "Add a caption..." : "Message..."}
              maxLength={1200}
              className="flex-1 bg-transparent text-[15px] text-white placeholder-[#8E8E93] focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || (!text.trim() && !pendingPhoto)}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5E5CE6] text-white transition disabled:opacity-35"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </form>
      </div>

      {/* Chat Options Action Sheet (<dialog>) */}
      <dialog
        ref={menuDialogRef}
        aria-labelledby={menuTitleId}
        onClose={() => setMenuOpen(false)}
        className="circle-dialog w-full"
      >
        {thread && (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18191E]">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <h1 id={menuTitleId} className="text-[15px] font-semibold text-white">
                {thread.persona.display_name}
              </h1>
              <button
                type="button"
                autoFocus
                onClick={() => setMenuOpen(false)}
                aria-label="Close options"
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="divide-y divide-white/[0.08]">
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  setMenuOpen(false);
                  void sendMessage("screenshot_alert", "Took a screenshot of this chat");
                }}
                className="w-full px-4 py-3.5 text-left text-[15px] text-white hover:bg-white/[0.04]"
              >
                Simulate Screenshot
              </button>

              <Link
                href={`/crew?inspect=${thread.persona.id}`}
                onClick={() => setMenuOpen(false)}
                className="block w-full px-4 py-3.5 text-left text-[15px] text-white hover:bg-white/[0.04]"
              >
                View Profile &amp; Insights
              </Link>
            </div>
          </div>
        )}
      </dialog>
    </AppShell>
  );
}
