import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { generateApiToken, generateIngestKey, hashPassword, sha256 } from '../src/security.js';

async function main() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);

  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'admin12345';

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  let userId: string;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    console.log(`admin user already exists: ${email}`);
  } else {
    const inserted = await db.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
      [email, hashPassword(password), 'Admin']
    );
    userId = inserted.rows[0].id;
    console.log(`created admin user  email=${email}  password=${password}`);
  }

  const project = await db.query('SELECT id, name, ingest_key FROM projects LIMIT 1');
  let ingestKey: string;
  if (project.rows.length > 0) {
    ingestKey = project.rows[0].ingest_key;
    console.log(`project already exists: ${project.rows[0].name}`);
  } else {
    ingestKey = generateIngestKey();
    await db.query(
      `INSERT INTO projects (name, slug, ingest_key, created_by) VALUES ($1, $2, $3, $4)`,
      ['Demo Site', 'demo-site', ingestKey, userId]
    );
    console.log('created project "Demo Site"');
  }
  console.log(`ingest key: ${ingestKey}`);

  // Only mint a token when there isn't one. Re-running seed on a deploy would
  // otherwise leave a trail of orphan write-scope tokens that can never be
  // matched back to their (long since printed) values.
  const existingToken = await db.query(`SELECT name FROM api_tokens LIMIT 1`);
  if (existingToken.rows.length > 0) {
    console.log(`API token already exists ("${existingToken.rows[0].name}") — not creating another.`);
    console.log('Create or revoke tokens in the dashboard under "API tokens".');
  } else {
    const token = generateApiToken();
    await db.query(
      `INSERT INTO api_tokens (name, token_hash, scope, created_by) VALUES ($1, $2, 'write', $3)`,
      ['seeded-mcp-token', sha256(token), userId]
    );
    console.log(`API token (write scope, shown once): ${token}`);
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
