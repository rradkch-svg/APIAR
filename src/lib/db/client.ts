import path from "path";
import fs from "fs";
import type { Pool as PgPool, PoolClient } from "pg";
import type { PGlite } from "@electric-sql/pglite";

export type DbDriverType = "postgres" | "pglite";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

interface DbGlobalState {
  driverType: DbDriverType;
  pgPool?: PgPool;
  pglite?: PGlite;
  initPromise?: Promise<void>;
  pgliteLock: Promise<void>;
}

const globalForDb = globalThis as unknown as {
  __circleDbState?: DbGlobalState;
};

function isExternalPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://");
}

function getState(): DbGlobalState {
  if (!globalForDb.__circleDbState) {
    const usePg = isExternalPostgresUrl(process.env.DATABASE_URL);
    globalForDb.__circleDbState = {
      driverType: usePg ? "postgres" : "pglite",
      pgliteLock: Promise.resolve(),
    };
  }
  return globalForDb.__circleDbState;
}

export function getDbDriverType(): DbDriverType {
  return getState().driverType;
}

async function ensureConnected(): Promise<DbGlobalState> {
  const state = getState();
  if (state.initPromise) {
    await state.initPromise;
    return state;
  }

  state.initPromise = (async () => {
    if (state.driverType === "postgres") {
      const { Pool } = await import("pg");
      state.pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 15,
      });
      await state.pgPool.query("SELECT 1");
    } else {
      const dataDir = path.resolve(process.cwd(), ".pglite-data");
      fs.mkdirSync(dataDir, { recursive: true });
      const [{ PGlite: PGliteClass }, { vector }, { uuid_ossp }] = await Promise.all([
        import("@electric-sql/pglite"),
        import("@electric-sql/pglite/vector"),
        import("@electric-sql/pglite/contrib/uuid_ossp"),
      ]);
      const instance = new PGliteClass(dataDir, {
        extensions: {
          vector,
          uuid_ossp,
        },
      });
      await instance.waitReady;
      state.pglite = instance;
    }
  })();

  try {
    await state.initPromise;
  } catch (err) {
    state.initPromise = undefined;
    throw err;
  }

  return state;
}

function serializePglite<T>(state: DbGlobalState, fn: () => Promise<T>): Promise<T> {
  const prev = state.pgliteLock;
  let release!: () => void;
  state.pgliteLock = new Promise<void>((res) => {
    release = res;
  });
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const state = await ensureConnected();
  if (state.driverType === "postgres" && state.pgPool) {
    const res = await state.pgPool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }
  const pg = state.pglite!;
  return serializePglite(state, async () => {
    const res = await pg.query<T>(sql, params);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  });
}

export async function dbQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const res = await dbQuery<T>(sql, params);
  return res.rows[0] ?? null;
}

export async function dbExec(sql: string): Promise<void> {
  const state = await ensureConnected();
  if (state.driverType === "postgres" && state.pgPool) {
    await state.pgPool.query(sql);
    return;
  }
  const pg = state.pglite!;
  await serializePglite(state, async () => {
    await pg.exec(sql);
  });
}

export async function dbTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const state = await ensureConnected();
  if (state.driverType === "postgres" && state.pgPool) {
    const client: PoolClient = await state.pgPool.connect();
    try {
      await client.query("BEGIN");
      const executor: DbExecutor = {
        async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
        async exec(sql: string) {
          await client.query(sql);
        },
      };
      const out = await fn(executor);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  const pg = state.pglite!;
  return serializePglite(state, async () => {
    return pg.transaction(async (tx) => {
      const executor: DbExecutor = {
        async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
          const res = await tx.query<R>(sql, params);
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
        },
        async exec(sql: string) {
          await tx.exec(sql);
        },
      };
      return fn(executor);
    });
  });
}
