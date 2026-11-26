"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/components/RealtimeProvider";

const CAMPUS_SPOTS = [
  "Main Quad",
  "West Quad Café",
  "Alden Library · 4F",
  "West Terrace Rooftop",
  "Elm St. Espresso",
  "Student Union",
];

export default function ComposePostPage() {
  const router = useRouter();
  const { refreshMe } = useRealtime();

  const [caption, setCaption] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [locationTag, setLocationTag] = useState("");
  const [audience, setAudience] = useState<"campus" | "close_friends">("campus");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 6 - mediaUrls.length);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setMediaUrls((prev) => [...prev.slice(0, 5), reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeSlide = (idx: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caption.trim() || posting) return;
    setError(null);
    setPosting(true);
    try {
      const res = await fetch("/api/v1/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: caption.trim(),
          image_url: mediaUrls[0] || null,
          media_urls: mediaUrls,
          location_tag: locationTag.trim() || null,
          audience,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not share post.");
        return;
      }
      await refreshMe();
      router.push("/feed");
    } catch {
      setError("Network error while sharing post.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <AppShell hideBottomNav>
      <form onSubmit={handleShare} className="flex min-h-dvh flex-col bg-[#0D0E12]">
        <header className="sticky top-0 z-20 flex h-[50px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12] px-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-[15px] text-[#8E8E93] hover:text-white"
          >
            Cancel
          </button>
          <h1 className="text-[16px] font-semibold text-white">New Post</h1>
          <span className="w-12" />
        </header>

        <div className="flex-1 space-y-4 px-4 py-4 pb-6">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
            id="compose-photo-input"
          />

          {mediaUrls.length > 0 ? (
            <div className="space-y-2.5">
              <div className="no-scrollbar flex gap-2.5 overflow-x-auto">
                {mediaUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-[4/3] w-[260px] shrink-0 overflow-hidden rounded-2xl bg-[#18191E]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Slide ${idx + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeSlide(idx)}
                      aria-label="Remove photo"
                      className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {mediaUrls.length > 1 && (
                      <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                        {idx + 1}/{mediaUrls.length}
                      </span>
                    )}
                  </div>
                ))}
                {mediaUrls.length < 6 && (
                  <label
                    htmlFor="compose-photo-input"
                    className="flex aspect-[4/3] w-[140px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/[0.08] bg-[#18191E] text-[#8E8E93] hover:text-white"
                  >
                    <Plus className="h-5 w-5" />
                    <span className="text-[12px]">Add slide</span>
                  </label>
                )}
              </div>
            </div>
          ) : (
            <label
              htmlFor="compose-photo-input"
              className="flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-[#18191E] text-[#8E8E93] transition hover:bg-[#1E2027] hover:text-white"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#262930] text-white">
                <Plus className="h-5 w-5" />
              </div>
              <span className="text-[14px] font-medium">Tap to add photo or carousel</span>
            </label>
          )}

          {/* Clean Borderless Caption Field */}
          <div className="border-b border-white/[0.08] pb-3">
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Write a caption..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-white placeholder-[#8E8E93] focus:outline-none"
            />
          </div>

          {/* Location & Audience */}
          <div className="divide-y divide-white/[0.08] rounded-2xl border border-white/[0.08] bg-[#18191E]">
            <div className="p-3.5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[#8E8E93]" />
                <input
                  type="text"
                  value={locationTag}
                  onChange={(e) => setLocationTag(e.target.value)}
                  placeholder="Add campus location (optional)"
                  maxLength={80}
                  className="flex-1 bg-transparent text-[14px] text-white placeholder-[#8E8E93] focus:outline-none"
                />
                {locationTag && (
                  <button
                    type="button"
                    onClick={() => setLocationTag("")}
                    className="text-[#8E8E93] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto">
                {CAMPUS_SPOTS.map((spot) => (
                  <button
                    key={spot}
                    type="button"
                    onClick={() => setLocationTag(spot)}
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition ${
                      locationTag === spot
                        ? "bg-[#5E5CE6] text-white"
                        : "bg-[#262930] text-[#8E8E93] hover:text-white"
                    }`}
                  >
                    {spot}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5">
              <span className="text-[14px] text-white">Audience</span>
              <div className="flex rounded-full bg-[#262930] p-0.5 text-[12px] font-medium">
                <button
                  type="button"
                  onClick={() => setAudience("campus")}
                  className={`rounded-full px-3 py-1 transition ${
                    audience === "campus" ? "bg-[#5E5CE6] text-white" : "text-[#8E8E93]"
                  }`}
                >
                  Campus
                </button>
                <button
                  type="button"
                  onClick={() => setAudience("close_friends")}
                  className={`rounded-full px-3 py-1 transition ${
                    audience === "close_friends" ? "bg-[#30D158] text-white" : "text-[#8E8E93]"
                  }`}
                >
                  Close Friends
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-[#2A181B] px-3.5 py-2.5 text-[13px] text-[#FF453A]">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-white/[0.08] bg-[#0D0E12] p-4">
          <button
            type="submit"
            disabled={posting || !caption.trim()}
            className="w-full rounded-full bg-[#5E5CE6] py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-40"
          >
            {posting ? "Sharing..." : "Share"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
