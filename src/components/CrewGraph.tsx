"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#18191E] text-[13px] text-[#8E8E93]">
      Loading social graph...
    </div>
  ),
});

export interface GraphNode {
  id: string;
  label: string;
  full_name?: string;
  handle?: string;
  clique: string;
  accent_color: string;
  affinity: number;
  is_user?: boolean;
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation_type: string;
  affinity: number;
  friction: number;
  gossip_trust: number;
  shared_lore: string;
  is_user_link: boolean;
}

interface CrewGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onSelectPersona: (personaId: string) => void;
}

function getEdgeColor(rel: string, isUserLink: boolean): string {
  if (isUserLink) return "rgba(94, 92, 230, 0.45)";
  if (rel === "rival" || rel === "ex") return "rgba(255, 69, 58, 0.72)";
  if (rel === "crush" || rel === "secret_fling") return "rgba(255, 55, 95, 0.78)";
  if (rel === "bestie" || rel === "friend" || rel === "bandmate")
    return "rgba(48, 209, 88, 0.62)";
  return "rgba(255, 255, 255, 0.25)";
}

export function CrewGraph({ nodes, links, onSelectPersona }: CrewGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(398);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(Math.max(280, Math.floor(containerRef.current.clientWidth)));
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0E12]"
      >
        <ForceGraph2D
          width={width}
          height={430}
          backgroundColor="#0D0E12"
          graphData={{
            nodes: nodes.map((n) => ({ ...n })),
            links: links.map((l) => ({ ...l })),
          }}
          nodeRelSize={6}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.28}
          cooldownTicks={90}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.85}
          linkCurvature={0.16}
          linkWidth={(link) => {
            const l = link as GraphLink;
            if (l.is_user_link) return 1.1;
            return l.friction > 0.65 || l.relation_type === "crush" ? 1.8 : 1.1;
          }}
          linkColor={(link) => {
            const l = link as GraphLink;
            return getEdgeColor(l.relation_type, l.is_user_link);
          }}
          onNodeClick={(node) => {
            const n = node as GraphNode;
            if (!n.is_user) onSelectPersona(n.id);
          }}
          onLinkHover={(link) => {
            setHoveredLink((link as GraphLink) || null);
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const r = n.is_user ? 7.5 : 5.5;

            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI, false);
            ctx.fillStyle = n.is_user ? "#5E5CE6" : "#FFFFFF";
            ctx.fill();
            ctx.lineWidth = 1.4 / globalScale;
            ctx.strokeStyle = "#0D0E12";
            ctx.stroke();

            const fontSize = Math.max(9, 11 / globalScale);
            ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = n.is_user ? "#FFFFFF" : "#AEAEB2";
            ctx.fillText(n.label, x, y + r + 3);
          }}
        />

        {hoveredLink && (
          <div className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 rounded-xl border border-white/[0.08] bg-[#18191E]/95 p-3 text-[12px] backdrop-blur-md">
            <div className="flex items-center justify-between font-semibold text-white">
              <span>
                {typeof hoveredLink.source === "object"
                  ? hoveredLink.source.label
                  : hoveredLink.source}{" "}
                →{" "}
                {typeof hoveredLink.target === "object"
                  ? hoveredLink.target.label
                  : hoveredLink.target}
              </span>
              <span className="capitalize text-[#8E8E93]">
                {hoveredLink.relation_type.replace("_", " ")}
              </span>
            </div>
            <p className="mt-0.5 text-[#8E8E93]">{hoveredLink.shared_lore}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-[12px] text-[#8E8E93]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#FF453A]" />
          Rival / Ex
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#FF375F]" />
          Crush
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#30D158]" />
          Friend
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#5E5CE6]" />
          You
        </span>
      </div>
    </div>
  );
}
