"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { CircleDashed, Lock, X } from "lucide-react";

interface PhotoMessageCardProps {
  messageId: string;
  personaId: string;
  mediaUrl: string;
  caption: string;
  accentColor?: string;
  viewOnce?: boolean;
  viewedAt?: string | null;
  sceneKind?: string;
  onViewedOnce?: (messageId: string, viewedAt: string) => void;
}

export function PhotoMessageCard({
  messageId,
  personaId,
  mediaUrl,
  caption,
  viewOnce = false,
  viewedAt = null,
  sceneKind = "ambient",
  onViewedOnce,
}: PhotoMessageCardProps) {
  const [open, setOpen] = useState(false);
  const [localViewedAt, setLocalViewedAt] = useState<string | null>(viewedAt);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    setLocalViewedAt(viewedAt);
  }, [viewedAt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleClose = async () => {
    setOpen(false);
    if (viewOnce && !localViewedAt) {
      try {
        const res = await fetch(
          `/api/v1/dms/${personaId}/messages/${messageId}/view`,
          { method: "POST" }
        );
        if (res.ok) {
          const data = (await res.json()) as { viewed_at: string };
          setLocalViewedAt(data.viewed_at);
          onViewedOnce?.(messageId, data.viewed_at);
        }
      } catch {
        setLocalViewedAt(new Date().toISOString());
      }
    }
  };

  if (viewOnce && localViewedAt) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[20px] border border-white/[0.08] bg-[#18191E] px-3.5 py-2 text-[13px] text-[#8E8E93]">
        <Lock className="h-3.5 w-3.5" />
        <span>Opened</span>
      </div>
    );
  }

  if (viewOnce && !localViewedAt) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2.5 rounded-[20px] bg-[#262626] px-4 py-2.5 text-left transition active:scale-[0.98]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
            <CircleDashed className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[14px] font-semibold text-white">Photo</div>
            <div className="text-[12px] text-[#8E8E93]">Tap to view once</div>
          </div>
        </button>

        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onClose={() => void handleClose()}
          className="circle-dialog w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0E12]">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <h1 id={titleId} className="text-[14px] font-semibold text-white">
                Photo
              </h1>
              <button
                type="button"
                autoFocus
                onClick={() => void handleClose()}
                aria-label="Close view-once photo"
                className="rounded-full p-1 text-[#8E8E93] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl} alt={caption || "Photo"} className="max-h-[75dvh] w-full object-cover" />
          </div>
        </dialog>
      </>
    );
  }

  // Clean full-bleed Instagram DM photo bubble — ZERO raw AI prompt text printed underneath!
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-[228px] max-w-full overflow-hidden rounded-[20px] bg-[#18191E]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl}
          alt={caption || "Shared photo"}
          className="aspect-[4/4.2] w-full object-cover"
        />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="circle-dialog w-full"
      >
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0E12]">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <h1 id={titleId} className="text-[14px] font-semibold text-white">
              {sceneKind === "selfie" ? "Photo" : "Photo"}
            </h1>
            <button
              type="button"
              autoFocus
              onClick={() => setOpen(false)}
              aria-label="Close photo"
              className="rounded-full p-1 text-[#8E8E93] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl} alt={caption || "Photo"} className="max-h-[78dvh] w-full object-cover" />
        </div>
      </dialog>
    </>
  );
}
