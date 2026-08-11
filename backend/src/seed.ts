import type { Db } from './db.js';
import { generateApiToken, generateIngestKey, hashPassword, sha256 } from './security.js';

/**
 * Distinct from the migration lock — a boot does both, and reusing one id would
 * mean the seed could never run while migrations held it. See migrate.ts for why
 * a session lock (not xact) and a bounded wait are used.
 */
const SEED_LOCK_ID = '728051924';
const LOCK_TIMEOUT = '60s';

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
  /** Mint a first write-scope API token when the database has none. */
  createToken?: boolean;
  log?: (message: string) => void;
}

export interface SeedResult {
  /** False when the admin already existed — its password was left untouched. */
  createdUser: boolean;
}

/**
 * Create the first admin user and project if they do not exist yet.
 *
 * Idempotent by design: it is run both from `npm run seed` and, on hosts with no
 * shell access (Railway and friends), on every boot via SEED_ON_BOOT. Re-running
 * must therefore never duplicate the user, the project, or the API token, and
 * must never reset an existing admin's password — a deployment that rotated its
 * credentials would otherwise have them silently reverted on the next restart.
 *
 * The whole run is serialized on an advisory lock so two containers booting
 * together cannot both pass the "does it exist?" check and insert twice.
 */
export async function runSeed(db: Db, opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? console.log;
  const client = await db.connect();
  let locked = false;
  let createdUser = false;
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query('SELECT pg_advisory_lock($1::bigint)', [SEED_LOCK_ID]);
    locked = true;

    const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      opts.adminEmail
    ]);
    let userId: string;
    const existingUser = existing.rows[0];
    if (existingUser) {
      userId = existingUser.id;
      log(`admin user already exists: ${opts.adminEmail}`);
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
        [opts.adminEmail, hashPassword(opts.adminPassword), 'Admin']
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('seed: INSERT ... RETURNING id produced no row');
      userId = row.id;
      createdUser = true;
      log(`created admin user  email=${opts.adminEmail}`);
    }

    const project = await client.query<{ name: string; ingest_key: string }>(
      'SELECT name, ingest_key FROM projects LIMIT 1'
    );
    const existingProject = project.rows[0];
    if (existingProject) {
      log(`project already exists: ${existingProject.name} (ingest key: ${existingProject.ingest_key})`);
    } else {
      const ingestKey = generateIngestKey();
      await client.query(
        `INSERT INTO projects (name, slug, ingest_key, created_by) VALUES ($1, $2, $3, $4)`,
        ['Demo Site', 'demo-site', ingestKey, userId]
      );
      log(`created project "Demo Site" (ingest key: ${ingestKey})`);
    }

    if (opts.createToken) {
      // Only when there isn't one. Re-running would otherwise leave a trail of
      // orphan write-scope tokens that can never be matched back to their (long
      // since printed) values.
      const existingToken = await client.query<{ name: string }>('SELECT name FROM api_tokens LIMIT 1');
      const token0 = existingToken.rows[0];
      if (token0) {
        log(`API token already exists ("${token0.name}") — not creating another.`);
        log('Create or revoke tokens in the dashboard under "API tokens".');
      } else {
        const token = generateApiToken();
        await client.query(
          `INSERT INTO api_tokens (name, token_hash, scope, created_by) VALUES ($1, $2, 'write', $3)`,
          ['seeded-mcp-token', sha256(token), userId]
        );
        log(`API token (write scope, shown once): ${token}`);
      }
    }
    return { createdUser };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [SEED_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}
