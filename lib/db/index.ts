import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import * as schema from "./schema.ts";

// Migrations are not run here (`pnpm db:migrate`, or the compose `migrate` service).

// One pool across dev-server module reloads.
const globalForDb = globalThis as unknown as { __cpPool?: Pool };

if (!globalForDb.__cpPool) {
  globalForDb.__cpPool = new Pool({ connectionString: env.DATABASE_URL });
  // Idle-client errors surface here; unhandled, they crash the process.
  globalForDb.__cpPool.on("error", (err) => logger.error({ err }, "postgres pool error"));
}
const pool = globalForDb.__cpPool;

export const db = drizzle(pool, { schema });
