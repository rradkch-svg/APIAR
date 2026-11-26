"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CrewGraph, type GraphLink, type GraphNode } from "@/components/CrewGraph";
import { PersonaDrawer, type CrewMemberDetail } from "@/components/PersonaDrawer";
import { useRealtime } from "@/components/RealtimeProvider";

const CLIQUE_TABS = [
  { id: "all", label: "All" },
  { id: "campus", label: "Campus" },
  { id: "influencers", label: "Influencers" },
  { id: "drama", label: "Drama" },
  { id: "arts", label: "Arts" },
  { id: "tech", label: "Tech" },
];

function CrewContent() {
  const searchParams = useSearchParams();
  const { subscribe } = useRealtime();
  const [crew, setCrew] = useState<CrewMemberDetail[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [clique, setClique] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const inspectParam = searchParams.get("inspect");

  const loadCrewData = useCallback(async () => {
    try {
      const [crewRes, netRes] = await Promise.all([
        fetch("/api/v1/graph/crew", { cache: "no-store" }),
        fetch("/api/v1/graph/network", { cache: "no-store" }),
      ]);
      if (crewRes.ok) {
        const c = await crewRes.json();
        setCrew(c.crew || []);
      }
      if (netRes.ok) {
        const n = await netRes.json();
        setNodes(n.nodes || []);
        setLinks(n.links || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCrewData();
    return subscribe((evName) => {
      if (evName === "world:update" || evName === "dm:bubble") {
        void loadCrewData();
      }
    });
  }, [loadCrewData, subscribe]);

  useEffect(() => {
    if (inspectParam && crew.some((c) => c.id === inspectParam)) {
      setSelectedId(inspectParam);
    }
  }, [inspectParam, crew]);

  const filteredCrew = crew.filter((member) => {
    if (clique !== "all" && member.clique !== clique) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        member.display_name.toLowerCase().includes(q) ||
        member.handle.toLowerCase().includes(q) ||
        member.archetype.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedPersona = crew.find((c) => c.id === selectedId) || null;

  return (
    <AppShell>
      {/* Top Search & Clean Segmented Switcher */}
      <header className="sticky top-0 z-20 space-y-2.5 border-b border-white/[0.08] bg-[#0D0E12]/95 px-4 pt-3 pb-3 backdrop-blur-md">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campus"
            className="w-full rounded-xl bg-[#18191E] py-2 pr-3.5 pl-10 text-[15px] text-white placeholder-[#8E8E93] focus:outline-none"
          />
        </div>

        {/* Clean iOS Segmented Control */}
        <div className="grid grid-cols-2 rounded-xl bg-[#18191E] p-0.5 text-[13px] font-semibold">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded-[10px] py-1.5 transition ${
              viewMode === "list" ? "bg-[#262930] text-white" : "text-[#8E8E93]"
            }`}
          >
            People
          </button>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            className={`rounded-[10px] py-1.5 transition ${
              viewMode === "graph" ? "bg-[#262930] text-white" : "text-[#8E8E93]"
            }`}
          >
            Social Graph
          </button>
        </div>

        {viewMode === "list" && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto pt-0.5">
            {CLIQUE_TABS.map((tab) => {
              const active = clique === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setClique(tab.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
                    active
                      ? "bg-[#5E5CE6] text-white"
                      : "bg-[#18191E] text-[#8E8E93] hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {viewMode === "graph" ? (
        <div className="px-4 py-4">
          <CrewGraph
            nodes={nodes}
            links={links}
            onSelectPersona={(pid) => setSelectedId(pid)}
          />
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {loading
            ? [1, 2, 3, 4, 5, 6].map((k) => (
                <div key={k} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-12 w-12 animate-pulse rounded-full bg-[#18191E]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-[#18191E]" />
                    <div className="h-3 w-48 animate-pulse rounded bg-[#18191E]" />
                  </div>
                </div>
              ))
            : filteredCrew.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
                >
                  <div className="relative h-12 w-12 shrink-0">
                    <div className="h-full w-full overflow-hidden rounded-full bg-[#262930]">
                      {member.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={member.avatar_url}
                          alt={member.display_name}
                          className="h-full w-full rounded-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                          {member.display_name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    {member.is_online && (
                      <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-[#0D0E12] bg-[#30D158]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold text-white">
                        {member.handle.replace(/^@/, "")}
                      </span>
                      <span className="shrink-0 text-[12px] text-[#8E8E93]">
                        {member.user_follows
                          ? member.persona_follows_back
                            ? "Mutual"
                            : "Following"
                          : member.persona_follows_back
                            ? "Follows you"
                            : member.relationship_stage}
                      </span>
                    </div>
                    <div className="truncate text-[13px] text-[#8E8E93]">
                      {member.display_name} · {member.archetype}
                    </div>
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-[#8E8E93]" />
                </button>
              ))}
        </div>
      )}

      <PersonaDrawer
        persona={selectedPersona}
        onClose={() => setSelectedId(null)}
        onFollowChanged={() => void loadCrewData()}
      />
    </AppShell>
  );
}

export default function CrewPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#0D0E12]" />}>
      <CrewContent />
    </Suspense>
  );
}
