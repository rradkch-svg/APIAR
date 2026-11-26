import { runMigrationsAndSeed } from "./migrate";
import { getDbDriverType } from "./client";

async function main() {
  console.log(`[db:init] Initializing schema with driver: ${getDbDriverType()}`);
  const res = await runMigrationsAndSeed(false);
  console.log(`[db:init] Ready — ${res.personasCount} personas, ${res.edgesCount} edges.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:init] Failed:", err);
  process.exit(1);
});
