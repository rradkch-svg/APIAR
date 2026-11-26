"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Calendar } from "lucide-react";

export interface ConflictResponse {
  conflict: true;
  message: string;
  existing_event: {
    id: string;
    title: string;
    scheduled_day: number;
    scheduled_slot: string;
    penalty_affinity: number;
  };
  existing_persona: {
    id: string;
    display_name: string;
    handle: string;
    accent_color: string;
  };
}

interface EventInviteCardProps {
  eventId: string;
  title: string;
  description: string;
  inviteLine: string;
  scheduledDay: number;
  scheduledSlot: string;
  rewardAffinity: number;
  status: string;
  accentColor?: string;
  onStatusChanged?: () => void;
}

const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late Night",
};

export function EventInviteCard({
  eventId,
  title,
  description,
  inviteLine,
  scheduledDay,
  scheduledSlot,
  status,
  onStatusChanged,
}: EventInviteCardProps) {
  const [localStatus, setLocalStatus] = useState(status);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ConflictResponse | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    setLocalStatus(status);
  }, [status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (conflict && !dialog.open) dialog.showModal();
    else if (!conflict && dialog.open) dialog.close();
  }, [conflict]);

  const sendResponse = async (action: "accept" | "decline", confirmFlake = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/world-events/${eventId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm_flake: confirmFlake }),
      });

      if (res.status === 409) {
        const data = (await res.json()) as ConflictResponse;
        setConflict(data);
        return;
      }

      if (res.ok) {
        setConflict(null);
        setLocalStatus(action === "accept" ? "accepted" : "declined");
        onStatusChanged?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const statusText: Record<string, string> = {
    pending: "Pending",
    accepted: "Accepted",
    declined: "Declined",
    flaked: "Flaked",
    completed: "Completed",
    expired: "Expired",
  };

  return (
    <>
      <div className="w-[275px] max-w-full overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#18191E]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5 text-[12px] text-[#8E8E93]">
          <span className="flex items-center gap-1.5 font-medium text-white">
            <Calendar className="h-3.5 w-3.5 text-[#5E5CE6]" />
            Day {scheduledDay} · {SLOT_LABELS[scheduledSlot] || scheduledSlot}
          </span>
          <span>{statusText[localStatus] || localStatus}</span>
        </div>

        <div className="p-3.5">
          <div className="text-[15px] font-semibold text-white">{title}</div>
          <p className="mt-1 text-[13px] leading-snug text-white/90">{inviteLine}</p>

          {localStatus === "pending" && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendResponse("accept", false)}
                className="flex-1 rounded-full bg-[#5E5CE6] py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendResponse("decline", false)}
                className="flex-1 rounded-full bg-[#262930] py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        onClose={() => setConflict(null)}
        className="circle-dialog w-full"
      >
        {conflict && (
          <div className="rounded-2xl border border-white/[0.08] bg-[#18191E] p-5">
            <h1 id={headingId} className="text-[16px] font-semibold text-white">
              Schedule Conflict
            </h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#8E8E93]">
              {conflict.message}
            </p>
            <p className="mt-2 text-[13px] text-[#8E8E93]">
              Flaking on {conflict.existing_persona.display_name} drops affinity (
              {conflict.existing_event.penalty_affinity}) and may spread in campus gossip.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendResponse("accept", true)}
                className="w-full rounded-full bg-[#FF453A] py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
              >
                Flake &amp; Accept New Plan
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setConflict(null)}
                className="w-full rounded-full bg-[#262930] py-2.5 text-[14px] font-semibold text-white"
              >
                Keep Existing Plan
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
