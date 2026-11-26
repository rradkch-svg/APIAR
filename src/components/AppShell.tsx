"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, Home, PlusSquare, Search } from "lucide-react";
import { useRealtime } from "./RealtimeProvider";

interface AppShellProps {
  children: React.ReactNode;
  hideBottomNav?: boolean;
}

export function AppShell({ children, hideBottomNav = false }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loadingMe } = useRealtime();

  useEffect(() => {
    if (!loadingMe && me?.needs_onboarding && pathname !== "/") {
      router.replace("/");
    }
  }, [loadingMe, me, pathname, router]);

  const user = me?.user;
  const hasActivityBadge = (me?.active_world_events_count ?? 0) > 0;
  const userInitial = (user?.display_name || "U").slice(0, 1).toUpperCase();

  const isFeed = pathname === "/feed";
  const isExplore = pathname.startsWith("/crew");
  const isCompose = pathname.startsWith("/compose");
  const isActivity = pathname.startsWith("/activity");
  const isProfile = pathname.startsWith("/profile") || pathname.startsWith("/settings");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col border-x border-white/[0.08] bg-[#0D0E12]">
      <main className={`flex-1 ${hideBottomNav ? "" : "pb-[54px]"}`}>{children}</main>

      {/* Native iOS 5-Icon Bottom Nav — Strictly NO text labels underneath */}
      {!hideBottomNav && (
        <nav
          aria-label="Main navigation"
          className="fixed bottom-0 left-1/2 z-30 flex h-[54px] w-full max-w-[430px] -translate-x-1/2 items-center justify-around border-t border-white/[0.08] bg-[#0D0E12]/95 px-2 backdrop-blur-md"
        >
          <Link
            href="/feed"
            aria-label="Home"
            className="flex h-11 w-11 items-center justify-center text-white transition active:scale-95"
          >
            <Home
              className={`h-[24px] w-[24px] ${
                isFeed ? "fill-white text-white" : "text-[#8E8E93] hover:text-white"
              }`}
              strokeWidth={isFeed ? 2.2 : 1.9}
            />
          </Link>

          <Link
            href="/crew"
            aria-label="Explore"
            className="flex h-11 w-11 items-center justify-center transition active:scale-95"
          >
            <Search
              className={`h-[24px] w-[24px] ${
                isExplore ? "text-white" : "text-[#8E8E93] hover:text-white"
              }`}
              strokeWidth={isExplore ? 2.6 : 1.9}
            />
          </Link>

          <Link
            href="/compose"
            aria-label="New Post"
            className="flex h-11 w-11 items-center justify-center transition active:scale-95"
          >
            <PlusSquare
              className={`h-[24px] w-[24px] ${
                isCompose ? "text-white" : "text-[#8E8E93] hover:text-white"
              }`}
              strokeWidth={isCompose ? 2.4 : 1.9}
            />
          </Link>

          <Link
            href="/activity"
            aria-label="Activity"
            className="relative flex h-11 w-11 items-center justify-center transition active:scale-95"
          >
            <Heart
              className={`h-[24px] w-[24px] ${
                isActivity ? "fill-white text-white" : "text-[#8E8E93] hover:text-white"
              }`}
              strokeWidth={isActivity ? 2.2 : 1.9}
            />
            {hasActivityBadge && !isActivity && (
              <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full bg-[#FF3B30]" />
            )}
          </Link>

          <Link
            href="/profile"
            aria-label="Profile"
            className="flex h-11 w-11 items-center justify-center transition active:scale-95"
          >
            <span
              className={`flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full bg-[#262930] text-[11px] font-semibold text-white ${
                isProfile ? "ring-[1.5px] ring-white ring-offset-2 ring-offset-[#0D0E12]" : ""
              }`}
            >
              {user?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar_url}
                  alt={user.display_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                userInitial
              )}
            </span>
          </Link>
        </nav>
      )}
    </div>
  );
}
