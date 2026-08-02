import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { registerAuth } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTokenRoutes } from './routes/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
}

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 200 * 1024
  });

  app.decorate('config', config);
  app.decorate('db', db);

  await app.register(cookie);
  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  registerAuth(app);
  registerAuthRoutes(app);
  registerTokenRoutes(app);

  return app;
}
