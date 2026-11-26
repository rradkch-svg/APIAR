import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const [personasRes, edgesRes] = await Promise.all([
      dbQuery<{
        id: string;
        display_name: string;
        handle: string;
        clique: string;
        archetype: string;
        accent_color: string;
        avatar_url: string | null;
        gossip_propensity: number;
        affinity: number;
        romantic_tension: number;
        current_mood: string;
        relationship_stage: string;
      }>(
        `SELECT
           p.id, p.display_name, p.handle, p.clique, p.archetype, p.accent_color,
           p.avatar_url, p.gossip_propensity,
           ups.affinity, ups.romantic_tension, ups.current_mood, ups.relationship_stage
         FROM personas p
         JOIN user_persona_state ups ON ups.persona_id = p.id AND ups.user_id = $1
         WHERE p.is_active = TRUE`,
        [user.id]
      ),
      dbQuery<{
        source_id: string;
        target_id: string;
        relation_type: string;
        affinity: number;
        friction: number;
        gossip_trust: number;
        shared_lore: string;
      }>("SELECT * FROM persona_edges"),
    ]);

    const nodes = [
      {
        id: "__user__",
        label: user.display_name,
        handle: user.handle,
        clique: "user",
        accent_color: "#FFFFFF",
        affinity: 100,
        is_user: true,
      },
      ...personasRes.rows.map((p) => ({
        id: p.id,
        label: p.display_name.split(" ")[0],
        full_name: p.display_name,
        handle: p.handle,
        clique: p.clique,
        archetype: p.archetype,
        accent_color: p.accent_color,
        avatar_url: p.avatar_url,
        gossip_propensity: p.gossip_propensity,
        affinity: p.affinity,
        romantic_tension: p.romantic_tension,
        current_mood: p.current_mood,
        relationship_stage: p.relationship_stage,
        is_user: false,
      })),
    ];

    const links = [
      // All 48 directed weighted bot <-> bot edges
      ...edgesRes.rows.map((e) => ({
        source: e.source_id,
        target: e.target_id,
        relation_type: e.relation_type,
        affinity: e.affinity,
        friction: e.friction,
        gossip_trust: e.gossip_trust,
        shared_lore: e.shared_lore,
        is_user_link: false,
      })),
      // Dynamic user <-> persona edges (strongest / active relationships for clean readability)
      ...personasRes.rows
        .filter((p) => p.affinity >= 32 || p.romantic_tension >= 20 || p.relationship_stage === "rival")
        .map((p) => ({
          source: "__user__",
          target: p.id,
          relation_type: p.relationship_stage,
          affinity: p.affinity,
          friction: p.relationship_stage === "rival" ? 0.75 : 0.15,
          gossip_trust: p.gossip_propensity,
          shared_lore: `Your current stage with ${p.display_name}: ${p.relationship_stage} (${p.affinity}/100)`,
          is_user_link: true,
        })),
    ];

    return NextResponse.json({
      nodes,
      links,
      stats: {
        persona_nodes: personasRes.rows.length,
        persona_edges: edgesRes.rows.length,
      },
    });
  } catch (err) {
    console.error("[GET /api/v1/graph/network] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load network graph" },
      { status: 500 }
    );
  }
}
