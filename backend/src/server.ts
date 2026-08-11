import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  // Before the port opens, so a healthy /api/health implies the schema is current.
  if (config.migrateOnBoot) await runMigrations(db);
  // For hosts with no shell (Railway, Fly, …) where `npm run seed` cannot be run
  // by hand. Idempotent, so leaving it on across restarts is harmless. No API
  // token is minted here — that would print a secret into the provider's deploy
  // logs; create one in the dashboard under "API tokens" instead.
  if (config.seedOnBoot) {
    await runSeed(db, { adminEmail: config.adminEmail, adminPassword: config.adminPassword });
  }
  const app = await buildApp(config, db);

  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
