export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ ensureDbReady }, { startBackgroundWorkers }] = await Promise.all([
      import("./lib/db/migrate"),
      import("./lib/workers/scheduler"),
    ]);
    try {
      await ensureDbReady();
      startBackgroundWorkers();
    } catch (err) {
      console.error("[instrumentation] Boot initialization error:", err);
    }
  }
}
