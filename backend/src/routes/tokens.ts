import type { FastifyInstance } from 'fastify';
import { generateApiToken, sha256 } from '../security.js';

export function registerTokenRoutes(app: FastifyInstance): void {
  app.get('/api/tokens', { preHandler: app.requireAdmin }, async () => {
    const { rows } = await app.db.query(
      `SELECT id, name, scope, last_used_at, created_at FROM api_tokens ORDER BY created_at DESC`
    );
    return { tokens: rows };
  });

  app.post<{ Body: { name?: string; scope?: string } }>(
    '/api/tokens',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            scope: { type: 'string', enum: ['read', 'write'] }
          }
        }
      }
    },
    async (request) => {
      const { name, scope = 'read' } = request.body;
      const token = generateApiToken();
      const { rows } = await app.db.query(
        `INSERT INTO api_tokens (name, token_hash, scope, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, scope, created_at`,
        [name, sha256(token), scope, request.auth!.userId]
      );
      // The raw token value is returned exactly once; only its hash is stored.
      return { token: rows[0], value: token };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/tokens/:id',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { rowCount } = await app.db.query(`DELETE FROM api_tokens WHERE id = $1`, [request.params.id]);
      if (rowCount === 0) return reply.code(404).send({ error: 'token not found' });
      return { ok: true };
    }
  );
}
