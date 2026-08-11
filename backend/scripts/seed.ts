import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { runSeed } from '../src/seed.js';

async function main() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);

  // The local workflow has a shell, so the CLI is the right place to hand out a
  // first API token for Claude. The boot path (SEED_ON_BOOT) deliberately does
  // not, to keep tokens out of a hosting provider's deploy logs.
  const password = config.adminPassword || 'admin12345';
  const { createdUser } = await runSeed(db, {
    adminEmail: config.adminEmail,
    adminPassword: password,
    createToken: true
  });
  // Only for a user we just created: an existing admin keeps whatever password
  // it already had, so printing this one would be a lie.
  if (createdUser) console.log(`admin password: ${password}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
