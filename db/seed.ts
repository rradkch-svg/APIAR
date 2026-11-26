import { runMigrationsAndSeed } from "../src/lib/db/migrate";
import { dbQuery, getDbDriverType } from "../src/lib/db/client";

async function main() {
  console.log(`[seed] DB driver: ${getDbDriverType()}`);
  const { personasCount, edgesCount } = await runMigrationsAndSeed(true);
  console.log(`[seed] Seeded ${personasCount} personas and ${edgesCount} directed edges.`);

  const bellaRoutes = await dbQuery<{
    source_id: string;
    target_id: string;
    leak_probability: string;
    relation_type: string;
  }>("SELECT source_id, target_id, leak_probability, relation_type FROM v_gossip_routes WHERE source_id = 'bella'");

  console.log("[seed] v_gossip_routes for Bella (hop-1):", bellaRoutes.rows);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
