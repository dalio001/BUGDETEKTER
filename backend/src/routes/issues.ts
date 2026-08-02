import type { FastifyInstance } from 'fastify';
import { signAttachmentUrl } from '../security.js';
import { isUuid, parsePaging } from '../util.js';

const STATUSES = new Set(['open', 'in_progress', 'resolved', 'ignored']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const CATEGORIES = new Set(['bug', 'feature']);

interface ListQuery {
  project_id?: string;
  status?: string;
  source?: string;
  search?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

export function attachmentUrl(app: FastifyInstance, attachmentId: string): string {
  const { exp, sig } = signAttachmentUrl(attachmentId, app.config.signingSecret);
  return `/api/attachments/${attachmentId}?exp=${exp}&sig=${sig}`;
}

export function registerIssueRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: ListQuery }>('/api/issues', { preHandler: app.authenticate }, async (request, reply) => {
    const q = request.query;
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.project_id) {
      if (!isUuid(q.project_id)) return reply.code(400).send({ error: 'invalid project_id' });
      params.push(q.project_id);
      where.push(`i.project_id = $${params.length}`);
    }
    if (q.status) {
      if (!STATUSES.has(q.status)) return reply.code(400).send({ error: 'invalid status' });
      params.push(q.status);
      where.push(`i.status = $${params.length}`);
    }
    if (q.source) {
      if (q.source !== 'auto' && q.source !== 'manual') return reply.code(400).send({ error: 'invalid source' });
      params.push(q.source);
      where.push(`i.source = $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.slice(0, 100)}%`);
      where.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length})`);
    }

    const sort =
      q.sort === 'frequency' ? 'i.event_count DESC, i.last_seen DESC'
      : q.sort === 'first_seen' ? 'i.first_seen DESC'
      : 'i.last_seen DESC';

    const { limit, offset } = parsePaging(q as Record<string, unknown>);
    params.push(limit, offset);

    const { rows } = await app.db.query(
      `SELECT i.id, i.project_id, p.name AS project_name, i.source, i.status, i.title,
              i.error_type, i.priority, i.category, i.event_count, i.first_seen, i.last_seen,
              COUNT(*) OVER()::int AS total
       FROM issues i JOIN projects p ON p.id = i.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${sort}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows[0]?.total ?? 0;
    const issues = rows.map(({ total: _t, ...issue }) => issue);

    // 24h hourly sparkline per listed issue, one grouped query for the page.
    const ids = issues.filter((i) => i.source === 'auto').map((i) => i.id);
    const sparks = new Map<string, number[]>();
    if (ids.length > 0) {
      const { rows: sparkRows } = await app.db.query(
        `SELECT issue_id, EXTRACT(EPOCH FROM date_trunc('hour', received_at))::bigint AS hour, COUNT(*)::int AS count
         FROM events
         WHERE issue_id = ANY($1) AND received_at > now() - interval '24 hours'
         GROUP BY 1, 2`,
        [ids]
      );
      const nowHour = Math.floor(Date.now() / 3_600_000) * 3600;
      for (const row of sparkRows) {
        const buckets = sparks.get(row.issue_id) ?? new Array(24).fill(0);
        const index = 23 - Math.floor((nowHour - Number(row.hour)) / 3600);
        if (index >= 0 && index < 24) buckets[index] += row.count;
        sparks.set(row.issue_id, buckets);
      }
    }

    return {
      issues: issues.map((issue) => ({ ...issue, spark: sparks.get(issue.id) ?? null })),
      total,
      limit,
      offset
    };
  });

  app.get<{ Params: { id: string } }>('/api/issues/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });

    const { rows } = await app.db.query(
      `SELECT i.*, p.name AS project_name
       FROM issues i JOIN projects p ON p.id = i.project_id
       WHERE i.id = $1`,
      [id]
    );
    const issue = rows[0];
    if (!issue) return reply.code(404).send({ error: 'issue not found' });
    delete issue.fingerprint;

    const [browsers, urls, sessions, latestEvent, attachments] = await Promise.all([
      app.db.query(
        `SELECT COALESCE(browser_name, 'Unknown') AS name, COUNT(*)::int AS count
         FROM events WHERE issue_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        [id]
      ),
      app.db.query(
        `SELECT COALESCE(url, '(unknown)') AS url, COUNT(*)::int AS count
         FROM events WHERE issue_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        [id]
      ),
      app.db.query(`SELECT COUNT(DISTINCT session_id)::int AS count FROM events WHERE issue_id = $1 AND session_id IS NOT NULL`, [id]),
      app.db.query(
        `SELECT type, message, stack, url, browser_name, browser_version, os_name, device_type, meta, received_at
         FROM events WHERE issue_id = $1 ORDER BY received_at DESC LIMIT 1`,
        [id]
      ),
      app.db.query(`SELECT id, filename, mime_type, size_bytes, created_at FROM attachments WHERE issue_id = $1 ORDER BY created_at`, [id])
    ]);

    return {
      issue,
      aggregates: {
        browsers: browsers.rows,
        urls: urls.rows,
        session_count: sessions.rows[0]?.count ?? 0
      },
      latest_event: latestEvent.rows[0] ?? null,
      attachments: attachments.rows.map((a) => ({ ...a, url: attachmentUrl(app, a.id) }))
    };
  });

  app.patch<{ Params: { id: string }; Body: { status?: string; priority?: string; category?: string } }>(
    '/api/issues/:id',
    { preHandler: app.requireWrite },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
      const { status, priority, category } = request.body ?? {};

      if (status !== undefined && !STATUSES.has(status)) return reply.code(400).send({ error: 'invalid status' });
      if (priority !== undefined && priority !== null && !PRIORITIES.has(priority)) return reply.code(400).send({ error: 'invalid priority' });
      if (category !== undefined && category !== null && !CATEGORIES.has(category)) return reply.code(400).send({ error: 'invalid category' });
      if (status === undefined && priority === undefined && category === undefined) {
        return reply.code(400).send({ error: 'nothing to update' });
      }

      const { rows: currentRows } = await app.db.query(`SELECT status FROM issues WHERE id = $1`, [id]);
      const current = currentRows[0];
      if (!current) return reply.code(404).send({ error: 'issue not found' });

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id];
      if (status !== undefined) {
        params.push(status);
        sets.push(`status = $${params.length}`);
        sets.push(status === 'resolved' ? 'resolved_at = now()' : 'resolved_at = NULL');
      }
      if (priority !== undefined) {
        params.push(priority);
        sets.push(`priority = $${params.length}`);
      }
      if (category !== undefined) {
        params.push(category);
        sets.push(`category = $${params.length}`);
      }

      const { rows } = await app.db.query(
        `UPDATE issues SET ${sets.join(', ')} WHERE id = $1
         RETURNING id, project_id, source, status, title, error_type, priority, category, event_count, first_seen, last_seen, resolved_at`,
        params
      );
      const issue = rows[0];

      if (status !== undefined && status !== current.status) {
        await app.db.query(
          `INSERT INTO comments (issue_id, user_id, author_label, kind, body) VALUES ($1, $2, $3, 'status_change', $4)`,
          [id, request.auth!.userId, request.auth!.authorLabel, `Status changed from ${current.status} to ${status}`]
        );
        app.feed.publish({
          issue_id: issue.id,
          project_id: issue.project_id,
          title: issue.title,
          status: issue.status,
          source: issue.source,
          event_count: issue.event_count,
          last_seen: new Date(issue.last_seen).toISOString(),
          kind: 'status_change'
        });
      }

      return { issue };
    }
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/issues/:id/events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
      const { limit, offset } = parsePaging(request.query, 20, 100);
      const { rows } = await app.db.query(
        `SELECT id, type, message, stack, url, session_id, browser_name, browser_version, os_name, device_type, meta, received_at,
                COUNT(*) OVER()::int AS total
         FROM events WHERE issue_id = $1
         ORDER BY received_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );
      return { events: rows.map(({ total: _t, ...e }) => e), total: rows[0]?.total ?? 0, limit, offset };
    }
  );
}
