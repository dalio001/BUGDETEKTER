import type { FastifyInstance } from 'fastify';
import { isUuid } from '../util.js';

const RANGES: Record<string, { interval: string; bucket: 'hour' | 'day' }> = {
  '24h': { interval: '24 hours', bucket: 'hour' },
  '7d': { interval: '7 days', bucket: 'day' },
  '30d': { interval: '30 days', bucket: 'day' }
};

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { project_id?: string; range?: string } }>(
    '/api/stats/overview',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const range = RANGES[request.query.range ?? '24h'];
      if (!range) return reply.code(400).send({ error: 'range must be 24h, 7d or 30d' });
      const projectId = request.query.project_id;
      if (projectId && !isUuid(projectId)) return reply.code(400).send({ error: 'invalid project_id' });

      const projectFilter = projectId ? 'AND project_id = $1' : '';
      const params = projectId ? [projectId] : [];

      const [buckets, totals, topIssues] = await Promise.all([
        app.db.query(
          `SELECT EXTRACT(EPOCH FROM date_trunc('${range.bucket}', received_at))::bigint AS t, COUNT(*)::int AS count
           FROM events
           WHERE received_at > now() - interval '${range.interval}' ${projectFilter}
           GROUP BY 1 ORDER BY 1`,
          params
        ),
        app.db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM events WHERE received_at > now() - interval '${range.interval}' ${projectFilter}) AS events,
             (SELECT COUNT(*)::int FROM issues WHERE status IN ('open', 'in_progress') ${projectId ? 'AND project_id = $1' : ''}) AS open_issues,
             (SELECT COUNT(*)::int FROM issues WHERE source = 'manual' AND status IN ('open', 'in_progress') ${projectId ? 'AND project_id = $1' : ''}) AS open_manual,
             (SELECT COUNT(*)::int FROM projects) AS projects`,
          params
        ),
        app.db.query(
          `SELECT i.id, i.title, i.status, i.source, i.event_count, i.last_seen, COUNT(e.id)::int AS recent_events
           FROM issues i JOIN events e ON e.issue_id = i.id
           WHERE e.received_at > now() - interval '${range.interval}' ${projectId ? 'AND i.project_id = $1' : ''}
           GROUP BY i.id ORDER BY recent_events DESC LIMIT 5`,
          params
        )
      ]);

      return {
        range: request.query.range ?? '24h',
        bucket: range.bucket,
        totals: totals.rows[0],
        buckets: buckets.rows.map((b) => ({ t: Number(b.t), count: b.count })),
        top_issues: topIssues.rows
      };
    }
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/issues/:id/stats',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
      const range = RANGES[request.query.range ?? '7d'];
      if (!range) return reply.code(400).send({ error: 'range must be 24h, 7d or 30d' });

      const { rows } = await app.db.query(
        `SELECT EXTRACT(EPOCH FROM date_trunc('${range.bucket}', received_at))::bigint AS t, COUNT(*)::int AS count
         FROM events
         WHERE issue_id = $1 AND received_at > now() - interval '${range.interval}'
         GROUP BY 1 ORDER BY 1`,
        [id]
      );
      return { bucket: range.bucket, buckets: rows.map((b) => ({ t: Number(b.t), count: b.count })) };
    }
  );
}
