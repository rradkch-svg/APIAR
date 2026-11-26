"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export interface MePayload {
  user: {
    id: string;
    handle: string;
    display_name: string;
    bio: string;
    context_tag: string;
    avatar_url: string | null;
    energy: number;
    max_energy: number;
    energy_reset_at: string;
    plan_tier: "free" | "pro";
    current_day: number;
    current_slot: "morning" | "afternoon" | "evening" | "late_night";
  } | null;
  needs_onboarding: boolean;
  followers_count?: number;
  following_count?: number;
  close_friends_count?: number;
  posts_count?: number;
  saved_count?: number;
  unread_total?: number;
  gossip_events_count?: number;
  active_world_events_count?: number;
  slot_meta?: {
    label: string;
    shortLabel: string;
    timeRange: string;
    emoji: string;
  };
  runtime?: {
    llm_mode: "gemini" | "openai_compatible" | "mock";
    llm_provider: "gemini" | "openai_compatible";
    roleplay_model: string;
    fast_model: string;
    embedding_model: string;
    image_mode?: string;
    tts_mode?: string;
    llm_base_url: string;
    has_api_key?: boolean;
    db_driver: "postgres" | "pglite";
    speed_multiplier: number;
  };
}

export interface ToastItem {
  id: string;
  title: string;
  body: string;
  route?: string;
  accent_color?: string;
}

type SseListener = (event: string, data: Record<string, unknown>) => void;

interface RealtimeContextValue {
  me: MePayload | null;
  loadingMe: boolean;
  refreshMe: () => Promise<void>;
  typingPersonas: Record<string, "typing" | "recording" | "sending_media">;
  subscribe: (fn: SseListener) => () => void;
  pushToast: (toast: Omit<ToastItem, "id">) => void;
  sseConnected: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MePayload | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [typingPersonas, setTypingPersonas] = useState<
    Record<string, "typing" | "recording" | "sending_media">
  >({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listenersRef = useRef<Set<SseListener>>(new Set());
  const toastHoverRef = useRef(false);

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    if (typeof document !== "undefined" && document.querySelector("dialog[open]")) {
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-1), { ...toast, id }]);
    setTimeout(() => {
      if (!toastHoverRef.current) {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/me", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as MePayload;
        setMe(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const userId = me?.user?.id;

  useEffect(() => {
    if (!userId) return;

    const es = new EventSource("/api/v1/events");
    const eventNames = [
      "connected",
      "typing:start",
      "typing:stop",
      "dm:bubble",
      "dm:read",
      "dm:reaction",
      "feed:comment",
      "feed:likes_bump",
      "notification:push",
      "world:update",
    ];

    const handleEvent = (evName: string) => (ev: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (evName === "connected") {
        setSseConnected(true);
      } else if (evName === "typing:start") {
        const pid = String(data.persona_id || "");
        const act = (data.activity as "typing" | "recording" | "sending_media") || "typing";
        if (pid) setTypingPersonas((prev) => ({ ...prev, [pid]: act }));
      } else if (evName === "typing:stop") {
        const pid = String(data.persona_id || "");
        if (pid) {
          setTypingPersonas((prev) => {
            const copy = { ...prev };
            delete copy[pid];
            return copy;
          });
        }
      } else if (evName === "notification:push") {
        pushToast({
          title: String(data.title || "Vela"),
          body: String(data.body || ""),
          route: data.route ? String(data.route) : undefined,
        });
        void refreshMe();
      } else if (evName === "world:update" || evName === "dm:bubble") {
        void refreshMe();
      }

      for (const listener of listenersRef.current) {
        listener(evName, data);
      }
    };

    const handlers = eventNames.map((name) => {
      const fn = handleEvent(name);
      es.addEventListener(name, fn);
      return [name, fn] as const;
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      for (const [name, fn] of handlers) {
        es.removeEventListener(name, fn);
      }
      es.close();
      setSseConnected(false);
    };
  }, [userId, pushToast, refreshMe]);

  const subscribe = useCallback((fn: SseListener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  return (
    <RealtimeContext.Provider
      value={{
        me,
        loadingMe,
        refreshMe,
        typingPersonas,
        subscribe,
        pushToast,
        sseConnected,
      }}
    >
      {children}

      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        onMouseEnter={() => {
          toastHoverRef.current = true;
        }}
        onMouseLeave={() => {
          toastHoverRef.current = false;
        }}
        className="pointer-events-none fixed top-3 left-1/2 z-50 flex w-full max-w-[420px] -translate-x-1/2 flex-col gap-2 px-3"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/[0.1] bg-[#18191E]/95 px-3.5 py-3 backdrop-blur-md"
          >
            <button
              type="button"
              onClick={() => {
                dismissToast(t.id);
                if (t.route) router.push(t.route);
              }}
              className="flex-1 text-left"
            >
              <div className="text-[13px] font-semibold text-white">{t.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[12px] text-[#8E8E93]">{t.body}</div>
            </button>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(t.id)}
              className="rounded-full p-1 text-[#8E8E93] hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside RealtimeProvider");
  return ctx;
}
