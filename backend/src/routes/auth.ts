import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth.js';
import { signJwt, verifyPassword } from '../security.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 3 },
            password: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const { rows } = await app.db.query(
        `SELECT id, email, name, role, password_hash FROM users WHERE email = $1`,
        [email]
      );
      const user = rows[0];
      if (!user || !verifyPassword(password!, user.password_hash)) {
        return reply.code(401).send({ error: 'invalid email or password' });
      }
      const token = signJwt({ sub: user.id }, app.config.jwtSecret, SESSION_TTL_SECONDS);
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: app.config.cookieSecure,
        path: '/',
        maxAge: SESSION_TTL_SECONDS
      });
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    }
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (auth.kind !== 'user') {
      return reply.code(403).send({ error: 'user session required' });
    }
    const { rows } = await app.db.query(`SELECT id, email, name, role FROM users WHERE id = $1`, [auth.userId]);
    return { user: rows[0] };
  });
}
