"use client";

import React from "react";

interface VelaLogoProps {
  size?: "sm" | "md" | "lg";
  showMark?: boolean;
}

export function VelaLogo({ size = "md", showMark = true }: VelaLogoProps) {
  const iconPx = size === "lg" ? 32 : size === "sm" ? 20 : 24;
  const textCls =
    size === "lg"
      ? "text-[28px] tracking-[-0.045em]"
      : size === "sm"
        ? "text-[17px] tracking-[-0.03em]"
        : "text-[22px] tracking-[-0.04em]";

  return (
    <span className="inline-flex items-center gap-2 select-none">
      {showMark && (
        <svg
          width={iconPx}
          height={iconPx}
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect width="36" height="36" rx="10" fill="#18191E" stroke="rgba(255,255,255,0.12)" />
          <circle cx="18" cy="18" r="10.5" stroke="#5E5CE6" strokeWidth="2.4" />
          <path
            d="M13 13.5 L18 23.5 L23 13.5"
            stroke="#FFFFFF"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className={`font-bold text-white ${textCls}`}>vela</span>
    </span>
  );
}
