"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

interface VoiceNotePlayerProps {
  mediaUrl: string | null;
  transcript: string;
  durationSec: number;
  accentColor?: string;
  waveform?: number[];
}

const SPEEDS = [1, 1.5, 2] as const;

function formatSec(s: number): string {
  const clamped = Math.max(0, Math.round(s));
  const m = Math.floor(clamped / 60);
  const rem = clamped % 60;
  return `${m}:${rem < 10 ? "0" : ""}${rem}`;
}

/**
 * Pure HTML5 <audio> voice note player backed by real neural human voices
 * (ElevenLabs / Gemini TTS / OpenAI TTS / Microsoft Edge Neural 22-Voice MP3).
 * ZERO robotic browser window.speechSynthesis!
 */
export function VoiceNotePlayer({
  mediaUrl,
  transcript,
  durationSec,
  waveform,
}: VoiceNotePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [actualDuration, setActualDuration] = useState(durationSec);
  const [showTranscript, setShowTranscript] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speed = SPEEDS[speedIdx];

  const bars =
    waveform && waveform.length >= 16
      ? waveform
      : [
          0.32, 0.55, 0.78, 0.45, 0.92, 0.68, 0.4, 0.84, 0.62, 0.95, 0.52, 0.72, 0.88, 0.48,
          0.76, 0.64, 0.9, 0.58, 0.42, 0.74, 0.66, 0.5, 0.36, 0.28,
        ];

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  const togglePlay = () => {
    if (!mediaUrl) {
      setShowTranscript(true);
      return;
    }

    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }

    setAudioError(false);
    if (!audioRef.current) {
      const el = new Audio(mediaUrl);
      el.preload = "auto";
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setActualDuration(el.duration);
        }
      };
      el.ontimeupdate = () => {
        if (el.duration && Number.isFinite(el.duration)) {
          setProgress(Math.min(1, el.currentTime / el.duration));
        }
      };
      el.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      el.onerror = () => {
        setPlaying(false);
        setAudioError(true);
        setShowTranscript(true);
      };
      audioRef.current = el;
    }

    const el = audioRef.current;
    el.playbackRate = speed;
    void el
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        setAudioError(true);
        setShowTranscript(true);
      });
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const elapsedSec = playing ? Math.round(progress * actualDuration) : actualDuration;

  return (
    <div className="w-[262px] max-w-full rounded-[20px] bg-[#262626] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5E5CE6] text-white transition active:scale-95"
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-white" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-white" />
          )}
        </button>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex h-7 items-center gap-[2.5px]" aria-hidden="true">
            {bars.map((height, idx) => {
              const barPct = (idx + 1) / bars.length;
              const filled = barPct <= progress;
              const pulseHeight = playing
                ? Math.max(
                    0.22,
                    Math.min(1, height * (0.82 + 0.22 * Math.sin(progress * 28 + idx)))
                  )
                : height;
              return (
                <span
                  key={idx}
                  className="flex-1 rounded-full transition-all duration-100"
                  style={{
                    height: `${Math.round(pulseHeight * 26)}px`,
                    backgroundColor: filled ? "#FFFFFF" : "rgba(255,255,255,0.28)",
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8E8E93]">
            <span className="tabular-nums">{formatSec(elapsedSec)}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cycleSpeed}
                className="rounded-full bg-[#18191E] px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                {speed}x
              </button>
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="text-[11px] font-medium text-[#8E8E93] hover:text-white"
              >
                {showTranscript ? "Hide" : "Transcript"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {audioError && (
        <div className="mt-1.5 text-[11px] text-[#8E8E93]">
          Audio unavailable — showing transcript.
        </div>
      )}

      {showTranscript && (
        <p className="mt-2 border-t border-white/[0.08] pt-2 text-[13px] leading-snug text-white/90">
          {transcript}
        </p>
      )}
    </div>
  );
}
