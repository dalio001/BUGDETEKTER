import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

async function main() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  try {
    await runMigrations(db);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
