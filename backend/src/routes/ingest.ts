import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { fingerprintEvent, type IngestEvent } from '../fingerprint.js';
import { parseUa } from '../ua.js';
import { withTransaction } from '../db.js';

const MAX_EVENTS_PER_BATCH = 50;
const MAX_STACK_CHARS = 16_000;
const MAX_MESSAGE_CHARS = 4_000;
const RATE_LIMIT_PER_MINUTE = 600;
const MAX_TRACKED_KEYS = 5_000;
/** Timestamps outside this window are ignored — Postgres rejects out-of-range values. */
const MIN_EVENT_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_EVENT_SKEW_MS = 24 * 3600 * 1000;

const EVENT_TYPES = new Set(['exception', 'unhandled_rejection', 'console_error', 'network_error', 'performance']);

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Simple in-memory token bucket per ingest key (single-process deployment). */
class RateLimiter {
  private buckets = new Map<string, Bucket>();

  take(key: string, count: number): boolean {
    const now = Date.now();
    // The ingest key is public (it ships in the page source), so unknown keys
    // reach this map — evict fully-refilled entries before it can grow without
    // bound.
    if (this.buckets.size >= MAX_TRACKED_KEYS) {
      for (const [existingKey, existing] of this.buckets) {
        if (now - existing.updatedAt > 60_000) this.buckets.delete(existingKey);
      }
      if (this.buckets.size >= MAX_TRACKED_KEYS) this.buckets.clear();
    }
    const bucket = this.buckets.get(key) ?? { tokens: RATE_LIMIT_PER_MINUTE, updatedAt: now };
    const refill = ((now - bucket.updatedAt) / 60_000) * RATE_LIMIT_PER_MINUTE;
    bucket.tokens = Math.min(RATE_LIMIT_PER_MINUTE, bucket.tokens + refill);
    bucket.updatedAt = now;
    if (bucket.tokens < count) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= count;
    this.buckets.set(key, bucket);
    return true;
  }
}

interface IngestBody {
  key?: string;
  sdk?: string;
  events?: IngestEvent[];
}

/** Reject clock-skewed or hostile timestamps that Postgres would refuse. */
export function isUsableTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_EVENT_TIMESTAMP_MS &&
    value <= Date.now() + MAX_EVENT_SKEW_MS
  );
}

function sanitizeEvent(raw: unknown): IngestEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== 'string' || !EVENT_TYPES.has(e.type)) return null;
  const meta = typeof e.meta === 'object' && e.meta !== null ? (e.meta as Record<string, unknown>) : {};
  return {
    type: e.type as IngestEvent['type'],
    message: typeof e.message === 'string' ? e.message.slice(0, MAX_MESSAGE_CHARS) : '',
    stack: typeof e.stack === 'string' ? e.stack.slice(0, MAX_STACK_CHARS) : undefined,
    error_type: typeof e.error_type === 'string' ? e.error_type.slice(0, 200) : undefined,
    url: typeof e.url === 'string' ? e.url.slice(0, 2_000) : undefined,
    timestamp: isUsableTimestamp(e.timestamp) ? e.timestamp : undefined,
    session_id: typeof e.session_id === 'string' ? e.session_id.slice(0, 100) : undefined,
    meta: Object.fromEntries(Object.entries(meta).slice(0, 20))
  };
}

export interface StoredEventResult {
  issueId: string;
  wasResolved: boolean;
  isNew: boolean;
  status: string;
  title: string;
  eventCount: number;
  lastSeen: string;
}

/**
 * Upsert the issue for one auto-captured event and insert the event row.
 * Regression rule: an event matching a resolved issue reopens it; ignored issues stay ignored.
 */
export async function storeAutoEvent(
  client: PoolClient,
  projectId: string,
  event: IngestEvent,
  ua: ReturnType<typeof parseUa>
): Promise<StoredEventResult> {
  const { fingerprint, title, errorType } = fingerprintEvent(event);

  const upsert = await client.query(
    `WITH old AS (
       SELECT id, status FROM issues WHERE project_id = $1 AND fingerprint = $2
     ), up AS (
       INSERT INTO issues (project_id, fingerprint, source, title, error_type, page_url, event_count, first_seen, last_seen)
       VALUES ($1, $2, 'auto', $3, $4, $5, 1, now(), now())
       ON CONFLICT (project_id, fingerprint) DO UPDATE SET
         event_count = issues.event_count + 1,
         last_seen   = now(),
         updated_at  = now(),
         status      = CASE WHEN issues.status = 'resolved' THEN 'open' ELSE issues.status END,
         resolved_at = CASE WHEN issues.status = 'resolved' THEN NULL ELSE issues.resolved_at END
       RETURNING id, status, title, event_count, last_seen
     )
     SELECT up.id, up.status, up.title, up.event_count, up.last_seen, old.status AS old_status
     FROM up LEFT JOIN old ON old.id = up.id`,
    [projectId, fingerprint, title, errorType, event.url ?? null]
  );
  const row = upsert.rows[0];
  const wasResolved = row.old_status === 'resolved';
  const isNew = row.old_status === undefined || row.old_status === null;

  await client.query(
    `INSERT INTO events (issue_id, project_id, type, message, stack, url, session_id,
                         browser_name, browser_version, os_name, device_type, meta, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             COALESCE(to_timestamp($13::double precision / 1000.0), now()))`,
    [
      row.id,
      projectId,
      event.type,
      event.message ?? '',
      event.stack ?? null,
      event.url ?? null,
      event.session_id ?? null,
      ua.browserName,
      ua.browserVersion,
      ua.osName,
      ua.deviceType,
      JSON.stringify(event.meta ?? {}),
      event.timestamp ?? null
    ]
  );

  if (wasResolved) {
    await client.query(
      `INSERT INTO comments (issue_id, author_label, kind, body)
       VALUES ($1, 'system', 'regression', 'Issue regressed: a new event arrived after it was marked resolved. Reopened.')`,
      [row.id]
    );
  }

  return {
    issueId: row.id,
    wasResolved,
    isNew,
    status: row.status,
    title: row.title,
    eventCount: row.event_count,
    lastSeen: row.last_seen
  };
}

export function registerIngestRoutes(app: FastifyInstance): void {
  const limiter = new RateLimiter();

  // sendBeacon posts as text/plain (a CORS "simple request" — no preflight); the body is JSON.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, null);
    }
  });

  app.post<{ Body: IngestBody }>('/api/ingest', { bodyLimit: 100 * 1024 }, async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || typeof body.key !== 'string' || !Array.isArray(body.events)) {
      return reply.code(400).send({ error: 'expected { key, events: [...] }' });
    }

    const events = body.events.slice(0, MAX_EVENTS_PER_BATCH).map(sanitizeEvent).filter((e): e is IngestEvent => e !== null);
    if (events.length === 0) {
      return reply.code(202).send({ accepted: 0 });
    }

    if (!limiter.take(body.key, events.length)) {
      return reply.code(429).send({ error: 'rate limit exceeded' });
    }

    const project = await app.db.query(`SELECT id FROM projects WHERE ingest_key = $1`, [body.key]);
    if (project.rows.length === 0) {
      return reply.code(401).send({ error: 'unknown ingest key' });
    }
    const projectId: string = project.rows[0].id;
    const ua = parseUa(request.headers['user-agent']);

    // Each event gets a savepoint so one unstorable event is dropped on its
    // own instead of rejecting the whole (fire-and-forget) batch.
    const results = await withTransaction(app.db, async (client) => {
      const stored: StoredEventResult[] = [];
      for (const [index, event] of events.entries()) {
        const savepoint = `ev_${index}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          stored.push(await storeAutoEvent(client, projectId, event, ua));
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          request.log.warn({ err, type: event.type }, 'dropped unstorable ingest event');
        }
      }
      return stored;
    });

    for (const result of results) {
      app.feed.publish({
        issue_id: result.issueId,
        project_id: projectId,
        title: result.title,
        status: result.status,
        source: 'auto',
        event_count: result.eventCount,
        last_seen: new Date(result.lastSeen).toISOString(),
        kind: result.wasResolved ? 'regression' : result.isNew ? 'created' : 'event'
      });
    }

    return reply.code(202).send({ accepted: results.length, dropped: events.length - results.length });
  });
}
