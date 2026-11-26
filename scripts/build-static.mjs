import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src", "app", "api");
const API_BACKUP = path.join(ROOT, ".static-build-api-backup");
const INSTR_FILE = path.join(ROOT, "src", "instrumentation.ts");
const INSTR_BACKUP = path.join(ROOT, ".static-build-instrumentation.ts");
const OUT_DIR = path.join(ROOT, "out");

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/APIAR";

function restore() {
  if (fs.existsSync(API_BACKUP) && !fs.existsSync(API_DIR)) {
    fs.renameSync(API_BACKUP, API_DIR);
  }
  if (fs.existsSync(INSTR_BACKUP) && !fs.existsSync(INSTR_FILE)) {
    fs.renameSync(INSTR_BACKUP, INSTR_FILE);
  }
}

process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restore();
  process.exit(143);
});

try {
  // Clean previous build artifacts so static export starts fresh
  fs.rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  // Next.js output:"export" disallows route handlers and instrumentation.ts
  if (fs.existsSync(API_DIR)) {
    fs.renameSync(API_DIR, API_BACKUP);
  }
  if (fs.existsSync(INSTR_FILE)) {
    fs.renameSync(INSTR_FILE, INSTR_BACKUP);
  }

  const res = spawnSync("npx", ["next", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      STATIC_EXPORT: "1",
      NEXT_PUBLIC_STATIC_MODE: "1",
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
  });

  if (res.status !== 0) {
    restore();
    process.exit(res.status ?? 1);
  }

  // Required by GitHub Pages so _next/ assets are not ignored by Jekyll
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
  console.log(`\n[build:static] Static export ready in ./out (basePath="${basePath}")`);
} finally {
  restore();
}
