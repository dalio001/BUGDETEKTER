import type { FastifyInstance } from 'fastify';
import { isUuid } from '../util.js';

export function registerCommentRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/issues/:id/comments', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
    const { rows } = await app.db.query(
      `SELECT c.id, c.author_label, c.kind, c.body, c.created_at, u.email AS author_email
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.issue_id = $1
       ORDER BY c.created_at`,
      [id]
    );
    return { comments: rows };
  });

  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/issues/:id/comments',
    {
      preHandler: app.requireWrite,
      schema: {
        body: {
          type: 'object',
          required: ['body'],
          properties: { body: { type: 'string', minLength: 1, maxLength: 10_000 } }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
      const issue = await app.db.query(`SELECT id FROM issues WHERE id = $1`, [id]);
      if (issue.rows.length === 0) return reply.code(404).send({ error: 'issue not found' });

      const { rows } = await app.db.query(
        `INSERT INTO comments (issue_id, user_id, author_label, kind, body)
         VALUES ($1, $2, $3, 'comment', $4)
         RETURNING id, author_label, kind, body, created_at`,
        [id, request.auth!.userId, request.auth!.authorLabel, request.body.body]
      );
      return reply.code(201).send({ comment: rows[0] });
    }
  );
}
