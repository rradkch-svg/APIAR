"use client";

import React, { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

interface VideoNotePlayerProps {
  mediaUrl: string;
  audioUrl?: string | null;
  caption: string;
  durationSec: number;
  accentColor?: string;
  isLiveVideo?: boolean;
}

/**
 * Clean Instagram-style vertical video clip player backed by real <video> or
 * photorealistic clip + real neural MP3/WAV audio track (zero Web Speech, zero prompt text leak).
 */
export function VideoNotePlayer({
  mediaUrl,
  audioUrl,
  caption,
  durationSec,
  isLiveVideo = false,
}: VideoNotePlayerProps) {
  const [muted, setMuted] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const tick = setInterval(() => {
      setElapsed((prev) => (prev + 0.2 >= durationSec ? 0 : Number((prev + 0.2).toFixed(1))));
    }, 200);
    return () => {
      clearInterval(tick);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, [durationSec]);

  const toggleSound = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);

    if (isLiveVideo && videoRef.current) {
      videoRef.current.muted = nextMuted;
      return;
    }

    if (audioUrl) {
      if (!audioRef.current) {
        const el = new Audio(audioUrl);
        el.onended = () => setMuted(true);
        audioRef.current = el;
      }
      if (!nextMuted) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => setMuted(true));
      } else {
        audioRef.current.pause();
      }
    }
  };

  const pct = Math.min(100, Math.round((elapsed / Math.max(1, durationSec)) * 100));

  return (
    <div className="relative w-[210px] overflow-hidden rounded-[20px] bg-[#18191E]">
      <div className="relative aspect-[9/13] w-full overflow-hidden">
        {isLiveVideo ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            autoPlay
            loop
            muted={muted}
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl}
            alt={caption || "Video note"}
            className="animate-ken-burns h-full w-full object-cover"
          />
        )}

        <div className="absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
            0:0{Math.max(3, Math.min(9, Math.round(durationSec)))}
          </span>
          {(isLiveVideo || audioUrl) && (
            <button
              type="button"
              onClick={toggleSound}
              aria-label={muted ? "Unmute video" : "Mute video"}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* Clean minimal progress bar — NO AI stage-direction prompt overlay! */}
        <div className="absolute right-2.5 bottom-2.5 left-2.5">
          <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full rounded-full bg-white transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
