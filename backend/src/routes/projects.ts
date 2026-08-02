import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateIngestKey } from '../security.js';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

function embedSnippet(request: FastifyRequest, ingestKey: string): string {
  const proto = request.headers['x-forwarded-proto'] ?? request.protocol;
  const base = `${proto}://${request.headers.host}`;
  return [
    `<script src="${base}/sdk/bugdetekter.min.js"></script>`,
    `<script>`,
    `  BugDetekter.init({ endpoint: "${base}/api/ingest", key: "${ingestKey}" });`,
    `</script>`
  ].join('\n');
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', { preHandler: app.authenticate }, async (request) => {
    const { rows } = await app.db.query(
      `SELECT p.id, p.name, p.slug, p.ingest_key, p.created_at,
              COUNT(i.id) FILTER (WHERE i.status IN ('open', 'in_progress'))::int AS open_issues,
              COALESCE(SUM(i.event_count), 0)::int AS total_events
       FROM projects p
       LEFT JOIN issues i ON i.project_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at`
    );
    return { projects: rows.map((p) => ({ ...p, snippet: embedSnippet(request, p.ingest_key) })) };
  });

  app.post<{ Body: { name?: string } }>(
    '/api/projects',
    {
      preHandler: app.requireWrite,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 } }
        }
      }
    },
    async (request, reply) => {
      const name = request.body.name!.trim();
      const base = slugify(name);
      // Suffix the slug on collision rather than failing the create.
      const { rows: existing } = await app.db.query(`SELECT slug FROM projects WHERE slug LIKE $1 || '%'`, [base]);
      const taken = new Set(existing.map((r) => r.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

      const { rows } = await app.db.query(
        `INSERT INTO projects (name, slug, ingest_key, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, ingest_key, created_at`,
        [name, slug, generateIngestKey(), request.auth!.userId]
      );
      const project = rows[0];
      return reply.code(201).send({ project: { ...project, snippet: embedSnippet(request, project.ingest_key) } });
    }
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { rows } = await app.db.query(`SELECT id, name, slug, ingest_key, created_at FROM projects WHERE id = $1`, [
      request.params.id
    ]);
    if (rows.length === 0) return reply.code(404).send({ error: 'project not found' });
    return { project: { ...rows[0], snippet: embedSnippet(request, rows[0].ingest_key) } };
  });
}
