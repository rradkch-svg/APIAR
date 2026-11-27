"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/components/RealtimeProvider";
import { formatShortTime } from "@/components/PostCard";

interface DmInboxItem {
  persona_id: string;
  display_name: string;
  handle: string;
  clique: string;
  archetype: string;
  avatar_url: string | null;
  affinity: number;
  unread_count: number;
  is_online: boolean;
  last_message_body: string | null;
  last_message_type: string | null;
  last_message_sender: string | null;
  last_message_at: string | null;
}

interface DmNoteItem {
  id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  author_name: string;
  author_handle: string;
  author_avatar: string | null;
  body: string;
  created_at: string;
}

function formatPreview(item: DmInboxItem): string {
  if (!item.last_message_body) return "Tap to message";
  if (item.last_message_type === "audio") return "Sent a voice note";
  if (item.last_message_type === "video") return "Sent a video";
  if (item.last_message_type === "image") return "Sent a photo";
  if (item.last_message_type === "post_share") return "Shared a post";
  if (item.last_message_type === "story_reply") return `Replied to story: ${item.last_message_body}`;
  if (item.last_message_type === "event_invite") return `Invite: ${item.last_message_body}`;
  if (item.last_message_type === "screenshot_alert") return "Screenshot alert";
  const prefix = item.last_message_sender === "user" ? "You: " : "";
  return `${prefix}${item.last_message_body}`;
}

export default function DmsInboxPage() {
  const router = useRouter();
  const { subscribe, typingPersonas, me } = useRealtime();
  const [threads, setThreads] = useState<DmInboxItem[]>([]);
  const [notes, setNotes] = useState<DmNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [activeNote, setActiveNote] = useState<DmNoteItem | null>(null);
  const [noteReplyText, setNoteReplyText] = useState("");
  const [sendingNoteReply, setSendingNoteReply] = useState(false);

  const noteDialogRef = useRef<HTMLDialogElement | null>(null);
  const replyNoteDialogRef = useRef<HTMLDialogElement | null>(null);

  const loadInboxAndNotes = useCallback(async () => {
    try {
      const [dmsRes, notesRes] = await Promise.all([
        fetch("/api/v1/dms", { cache: "no-store" }),
        fetch("/api/v1/notes", { cache: "no-store" }),
      ]);
      if (dmsRes.ok) {
        const data = (await dmsRes.json()) as { threads: DmInboxItem[] };
        setThreads(data.threads || []);
      }
      if (notesRes.ok) {
        const data = (await notesRes.json()) as { notes: DmNoteItem[] };
        setNotes(data.notes || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInboxAndNotes();
    return subscribe((evName) => {
      if (evName === "dm:bubble" || evName === "world:update" || evName === "notification:push") {
        void loadInboxAndNotes();
      }
    });
  }, [loadInboxAndNotes, subscribe]);

  useEffect(() => {
    const d = noteDialogRef.current;
    if (!d) return;
    if (noteModalOpen && !d.open) d.showModal();
    else if (!noteModalOpen && d.open) d.close();
  }, [noteModalOpen]);

  useEffect(() => {
    const d = replyNoteDialogRef.current;
    if (!d) return;
    if (activeNote && !d.open) d.showModal();
    else if (!activeNote && d.open) d.close();
  }, [activeNote]);

  const userNote = notes.find((n) => n.author_type === "user") || null;
  const personaNotes = notes.filter((n) => n.author_type === "persona");

  const saveMyNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch("/api/v1/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteDraft.trim() }),
      });
      if (res.ok) {
        setNoteModalOpen(false);
        void loadInboxAndNotes();
      }
    } finally {
      setSavingNote(false);
    }
  };

  const clearMyNote = async () => {
    await fetch("/api/v1/notes", { method: "DELETE" });
    setNoteDraft("");
    setNoteModalOpen(false);
    void loadInboxAndNotes();
  };

  const replyToNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNote?.author_persona_id || !noteReplyText.trim() || sendingNoteReply) return;
    setSendingNoteReply(true);
    try {
      const res = await fetch(`/api/v1/dms/${activeNote.author_persona_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: noteReplyText.trim(),
          message_type: "note_reply",
          media_metadata: { note_body: activeNote.body },
        }),
      });
      if (res.ok) {
        const targetId = activeNote.author_persona_id;
        setActiveNote(null);
        setNoteReplyText("");
        router.push(`/dms/${targetId}`);
      }
    } finally {
      setSendingNoteReply(false);
    }
  };

  const filtered = threads.filter((t) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return t.display_name.toLowerCase().includes(q) || t.handle.toLowerCase().includes(q);
  });

  const activeChats = filtered;

  const username = (me?.user?.handle || "Messages").replace(/^@/, "");
  const userInitial = (me?.user?.display_name || "Y").slice(0, 1).toUpperCase();

  const renderThreadRow = (item: DmInboxItem) => {
    const typingActivity = typingPersonas[item.persona_id];
    const isUnread = item.unread_count > 0;
    return (
      <Link
        key={item.persona_id}
        href={`/dms/${item.persona_id}`}
        className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
      >
        <div className="relative h-[52px] w-[52px] shrink-0">
          <div className="h-full w-full overflow-hidden rounded-full bg-[#262930]">
            {item.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.avatar_url}
                alt={item.display_name}
                className="h-full w-full rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-base font-semibold">
                {item.display_name.slice(0, 1)}
              </div>
            )}
          </div>
          {item.is_online && (
            <span className="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-2 border-[#0D0E12] bg-[#30D158]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`truncate text-[14px] ${
                isUnread ? "font-bold text-white" : "font-medium text-white"
              }`}
            >
              {item.display_name}
            </span>
            {item.last_message_at && (
              <span className="shrink-0 text-[12px] text-[#8E8E93]">
                {formatShortTime(item.last_message_at)}
              </span>
            )}
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2">
            {typingActivity ? (
              <span className="truncate text-[13px] font-medium text-[#5E5CE6]">
                {typingActivity === "recording"
                  ? "Recording audio..."
                  : typingActivity === "sending_media"
                    ? "Sending photo..."
                    : "Typing..."}
              </span>
            ) : (
              <p
                className={`truncate text-[13px] ${
                  isUnread ? "font-semibold text-white" : "text-[#8E8E93]"
                }`}
              >
                {formatPreview(item)}
              </p>
            )}

            {isUnread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#5E5CE6]" />}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <AppShell>
      {/* Clean Instagram DM Inbox Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0D0E12]/95 px-3 pt-2.5 pb-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <Link
            href="/feed"
            aria-label="Back to Feed"
            className="flex items-center gap-0.5 text-[15px] text-white"
          >
            <ChevronLeft className="h-6 w-6" />
            <span className="text-[18px] font-bold tracking-[-0.02em]">{username}</span>
          </Link>
        </div>

        <div className="relative mt-2.5 px-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-xl bg-[#18191E] py-2 pr-3 pl-9 text-[15px] text-white placeholder-[#8E8E93] focus:outline-none"
          />
        </div>
      </header>

      {/* Instagram DM Notes Rail (60-char campus thought bubbles) */}
      <section
        aria-label="Campus Notes"
        className="no-scrollbar flex gap-3.5 overflow-x-auto border-b border-white/[0.08] px-4 pt-5 pb-3"
      >
        {/* User's Note */}
        <button
          type="button"
          onClick={() => {
            setNoteDraft(userNote?.body || "");
            setNoteModalOpen(true);
          }}
          className="relative flex w-[74px] shrink-0 flex-col items-center"
        >
          <div className="mb-[-10px] z-10 max-w-[82px] rounded-2xl border border-white/[0.1] bg-[#262930] px-2.5 py-1.5 text-center text-[11px] leading-tight text-white/90">
            <span className="line-clamp-2">{userNote ? userNote.body : "Drop a note..."}</span>
          </div>
          <div className="flex h-[58px] w-[58px] items-center justify-center overflow-hidden rounded-full bg-[#18191E] text-lg font-semibold text-white">
            {me?.user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.user.avatar_url}
                alt="Your note"
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              userInitial
            )}
          </div>
          <span className="mt-1 w-full truncate text-center text-[11px] text-[#8E8E93]">
            Your note
          </span>
        </button>

        {/* Persona Notes */}
        {personaNotes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => {
              setActiveNote(n);
              setNoteReplyText("");
            }}
            className="relative flex w-[74px] shrink-0 flex-col items-center"
          >
            <div className="mb-[-10px] z-10 max-w-[84px] rounded-2xl border border-white/[0.1] bg-[#18191E] px-2.5 py-1.5 text-center text-[11px] leading-tight text-white">
              <span className="line-clamp-2">{n.body}</span>
            </div>
            <div className="h-[58px] w-[58px] overflow-hidden rounded-full bg-[#262930]">
              {n.author_avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={n.author_avatar}
                  alt={n.author_name}
                  className="h-full w-full rounded-full object-cover"
                />
              )}
            </div>
            <span className="mt-1 w-full truncate text-center text-[11px] text-white/85">
              {n.author_handle}
            </span>
          </button>
        ))}
      </section>

      {/* Active Conversations */}
      {loading ? (
        <div className="py-2">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="flex items-center gap-3 px-4 py-3">
              <div className="h-[52px] w-[52px] animate-pulse rounded-full bg-[#18191E]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 animate-pulse rounded bg-[#18191E]" />
                <div className="h-3 w-48 animate-pulse rounded bg-[#18191E]" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-1 text-[14px] font-semibold text-white">Messages</div>
          {activeChats.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-white">
                {query.trim() ? "No matching chats" : "No messages yet"}
              </p>
              <p className="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-[#8E8E93]">
                {query.trim()
                  ? "Only active conversations appear in your inbox."
                  : "Visit someone's profile on Explore or reply to a Story to start a conversation."}
              </p>
              {!query.trim() && (
                <Link
                  href="/crew"
                  className="mt-4 rounded-full bg-[#5E5CE6] px-5 py-2 text-[13px] font-semibold text-white"
                >
                  Explore Campus
                </Link>
              )}
            </div>
          ) : (
            <div>{activeChats.map(renderThreadRow)}</div>
          )}
        </>
      )}

      {/* Your Note Composer <dialog> */}
      <dialog
        ref={noteDialogRef}
        onClose={() => setNoteModalOpen(false)}
        className="circle-dialog w-full"
      >
        {noteModalOpen && (
          <form
            onSubmit={saveMyNote}
            className="rounded-2xl border border-white/[0.1] bg-[#18191E] p-4"
          >
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-[16px] font-semibold text-white">New Note</h2>
              <button
                type="button"
                onClick={() => setNoteModalOpen(false)}
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Share a quick thought..."
              maxLength={60}
              className="w-full rounded-xl bg-[#0D0E12] px-3.5 py-3 text-[15px] text-white placeholder-[#8E8E93] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between text-[12px] text-[#8E8E93]">
              <span>Visible for 24h above inbox</span>
              <span className="tabular-nums">{noteDraft.length}/60</span>
            </div>
            <div className="mt-4 flex gap-2">
              {userNote && (
                <button
                  type="button"
                  onClick={() => void clearMyNote()}
                  className="rounded-full bg-[#262930] px-4 py-2 text-[13px] font-semibold text-white"
                >
                  Clear
                </button>
              )}
              <button
                type="submit"
                disabled={!noteDraft.trim() || savingNote}
                className="flex-1 rounded-full bg-[#5E5CE6] py-2 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {savingNote ? "Sharing..." : "Share Note"}
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* Reply to Persona Note <dialog> */}
      <dialog
        ref={replyNoteDialogRef}
        onClose={() => setActiveNote(null)}
        className="circle-dialog w-full"
      >
        {activeNote && (
          <form
            onSubmit={replyToNote}
            className="rounded-2xl border border-white/[0.1] bg-[#18191E] p-4"
          >
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2.5">
                {activeNote.author_avatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeNote.author_avatar}
                    alt={activeNote.author_name}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                )}
                <div>
                  <div className="text-[14px] font-semibold text-white">
                    {activeNote.author_name}
                  </div>
                  <div className="text-[12px] text-[#8E8E93]">@{activeNote.author_handle}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveNote(null)}
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#0D0E12] px-4 py-3 text-[15px] text-white">
              “{activeNote.body}”
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={noteReplyText}
                onChange={(e) => setNoteReplyText(e.target.value)}
                placeholder={`Reply to ${activeNote.author_name.split(" ")[0]}'s note...`}
                maxLength={240}
                className="flex-1 rounded-full bg-[#0D0E12] px-4 py-2.5 text-[14px] text-white placeholder-[#8E8E93] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!noteReplyText.trim() || sendingNoteReply}
                className="rounded-full bg-[#5E5CE6] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
        )}
      </dialog>
    </AppShell>
  );
}
