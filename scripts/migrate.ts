// One-shot migration runner: the `migrate` compose service and `pnpm db:migrate`.
// Run with: node --env-file=.env scripts/migrate.ts   (env file optional)

import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { platformStats } from "../lib/data.ts";
import { db } from "../lib/db/index.ts";
import { logger } from "../lib/logger.ts";

async function main() {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  logger.info("migrations applied");
  const stats = await platformStats();
  logger.info(stats, "after migration");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
