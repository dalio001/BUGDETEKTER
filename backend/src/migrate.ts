import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Fixed key for pg_advisory_lock. Every process that migrates this database must
 * use the same value. Nothing else in the app takes advisory locks, so there is
 * only ever one in play and no lock-ordering cycle is possible. Passed as a
 * string so pg sends a real int8 rather than a JS float.
 */
const MIGRATION_LOCK_ID = '728051923';

/** Bounded wait for the lock: a wedged peer should surface, not hang the boot forever. */
const LOCK_TIMEOUT = '120s';

/**
 * Apply every unapplied migrations/*.sql, one transaction per file.
 *
 * Concurrency: a *session* advisory lock is held across the whole run — the read
 * of `_migrations` and every apply — so two containers booting at once serialize
 * instead of both seeing the same "applied" set and double-applying. A session
 * lock (not xact) is required because the read must be inside the same lock as
 * the writes. Session locks survive COMMIT/ROLLBACK, so the per-file
 * transactions are unaffected, and Postgres drops them when the connection
 * dies — a crashed migrator can never wedge the next boot.
 *
 * The caller owns the pool; this never calls db.end(). The client is always
 * released so a later db.end() cannot hang on a checked-out connection.
 */
export async function runMigrations(db: Db): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await db.connect();
  let locked = false;
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    locked = true;
    // Migrations may legitimately wait on real table locks; don't cap those.
    await client.query('SET lock_timeout = 0');

    // Inside the lock deliberately: CREATE TABLE IF NOT EXISTS is not race-safe
    // in Postgres — concurrent creators can fail on a pg_type unique violation.
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file}`);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        // Roll back before the finally block runs pg_advisory_unlock: any query
        // in an aborted transaction fails with 25P02.
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      console.log(`apply  ${file}`);
    }
    console.log('migrations up to date');
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}
