"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/RealtimeProvider";
import { VelaLogo } from "@/components/VelaLogo";

const CONTEXT_TAGS = [
  { id: "undergrad", label: "Freshman" },
  { id: "transfer", label: "Transfer" },
  { id: "night_owl", label: "Night Owl" },
  { id: "creative", label: "Arts & Film" },
  { id: "cs_gamer", label: "Tech & CS" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { me, loadingMe, refreshMe } = useRealtime();

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("just got to campus · coffee & late walks");
  const [contextTag, setContextTag] = useState("undergrad");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingMe && me?.user && !me.needs_onboarding) {
      router.replace("/feed");
    }
  }, [loadingMe, me, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!displayName.trim() || !handle.trim()) {
      setError("Enter a display name and username to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          handle: handle.trim(),
          bio: bio.trim(),
          context_tag: contextTag,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create your profile.");
        return;
      }
      await refreshMe();
      router.push("/feed");
    } catch {
      setError("Network error while creating your profile.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-between border-x border-white/[0.08] bg-[#0D0E12] px-6 py-12">
      <div>
        <VelaLogo size="lg" />
        <h1 className="mt-5 text-[24px] font-bold leading-tight tracking-[-0.02em] text-white">
          Welcome to campus
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#8E8E93]">
          You&apos;re starting from zero — 0 followers, 22 real-feeling students who don&apos;t know
          you yet. Earn trust, build friendships, and see where the semester goes.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18191E]">
            <div className="px-4 py-3">
              <label htmlFor="displayName" className="block text-[12px] text-[#8E8E93]">
                Name
              </label>
              <input
                id="displayName"
                type="text"
                required
                maxLength={80}
                placeholder="Alex Rivera"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (!handle) {
                    const suggested = e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]/g, "")
                      .slice(0, 16);
                    if (suggested) setHandle(`@${suggested}`);
                  }
                }}
                className="mt-1 w-full bg-transparent text-[15px] text-white placeholder-[#5C5E66] focus:outline-none"
              />
            </div>

            <div className="px-4 py-3">
              <label htmlFor="handle" className="block text-[12px] text-[#8E8E93]">
                Username
              </label>
              <input
                id="handle"
                type="text"
                required
                maxLength={32}
                placeholder="@alexrivera"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="mt-1 w-full bg-transparent text-[15px] text-white placeholder-[#5C5E66] focus:outline-none"
              />
            </div>

            <div className="px-4 py-3">
              <label htmlFor="bio" className="block text-[12px] text-[#8E8E93]">
                Bio
              </label>
              <textarea
                id="bio"
                rows={2}
                maxLength={240}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1 w-full resize-none bg-transparent text-[14px] text-white placeholder-[#5C5E66] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <span className="block px-1 text-[12px] font-medium text-[#8E8E93]">Campus Year / Vibe</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONTEXT_TAGS.map((tag) => {
                const active = contextTag === tag.id;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setContextTag(tag.id)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                      active
                        ? "bg-[#5E5CE6] text-white"
                        : "bg-[#18191E] text-[#8E8E93] hover:text-white"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-[#2A181B] px-3.5 py-2.5 text-[13px] text-[#FF453A]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-full bg-[#5E5CE6] py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            {submitting ? "Joining campus..." : "Join Vela"}
          </button>
        </form>
      </div>

      <p className="mt-8 text-center text-[12px] text-[#8E8E93]">
        Connect live AI keys (LLM, Photos &amp; Voices) anytime in Profile Settings.
      </p>
    </div>
  );
}
