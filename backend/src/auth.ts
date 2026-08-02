import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sha256, verifyJwt } from './security.js';

export const SESSION_COOKIE = 'bd_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface AuthContext {
  kind: 'user' | 'token';
  userId: string | null;
  role: 'admin' | 'member' | null;
  scope: 'read' | 'write';
  /** Shown on comments/status changes: the user's name, or "Claude (MCP)" for API tokens. */
  authorLabel: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireWrite: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function resolveAuth(app: FastifyInstance, request: FastifyRequest): Promise<AuthContext | null> {
  const bearer = request.headers.authorization;
  if (bearer?.startsWith('Bearer ')) {
    const token = bearer.slice('Bearer '.length).trim();
    if (!token.startsWith('bd_')) return null;
    const { rows } = await app.db.query(
      `UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING id, name, scope`,
      [sha256(token)]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      kind: 'token',
      userId: null,
      role: null,
      scope: row.scope as 'read' | 'write',
      authorLabel: 'Claude (MCP)'
    };
  }

  const cookie = request.cookies[SESSION_COOKIE];
  if (cookie) {
    const payload = verifyJwt(cookie, app.config.jwtSecret);
    if (!payload || typeof payload.sub !== 'string') return null;
    const { rows } = await app.db.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [payload.sub]);
    const user = rows[0];
    if (!user) return null;
    return {
      kind: 'user',
      userId: user.id,
      role: user.role as 'admin' | 'member',
      scope: 'write',
      authorLabel: user.name || user.email
    };
  }

  return null;
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    request.auth = await resolveAuth(app, request);
    if (!request.auth) {
      await reply.code(401).send({ error: 'authentication required' });
    }
  });

  app.decorate('requireWrite', async (request: FastifyRequest, reply: FastifyReply) => {
    request.auth = request.auth ?? (await resolveAuth(app, request));
    if (!request.auth) {
      await reply.code(401).send({ error: 'authentication required' });
      return;
    }
    if (request.auth.scope !== 'write') {
      await reply.code(403).send({ error: 'write scope required — this API token is read-only' });
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    request.auth = request.auth ?? (await resolveAuth(app, request));
    if (!request.auth) {
      await reply.code(401).send({ error: 'authentication required' });
      return;
    }
    if (request.auth.kind !== 'user' || request.auth.role !== 'admin') {
      await reply.code(403).send({ error: 'admin access required' });
    }
  });
}
