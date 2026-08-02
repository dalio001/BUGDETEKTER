import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { registerAuth } from './auth.js';
import { FeedBus } from './feed.js';
import { createStorage, type StorageDriver } from './storage/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerFeedRoutes } from './routes/feed.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    feed: FeedBus;
    storage: StorageDriver;
  }
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 200 * 1024,
    trustProxy: true
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('feed', new FeedBus());
  app.decorate('storage', await createStorage(config));

  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 20 }
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  registerAuth(app);
  registerAuthRoutes(app);
  registerTokenRoutes(app);
  registerIngestRoutes(app);
  registerProjectRoutes(app);
  registerIssueRoutes(app);
  registerCommentRoutes(app);
  registerReportRoutes(app);
  registerAttachmentRoutes(app);
  registerStatsRoutes(app);
  registerFeedRoutes(app);

  // Serve the built SDK at /sdk/ so the embed snippet works out of the box.
  const sdkDist = path.join(repoRoot, 'sdk', 'dist');
  if (existsSync(sdkDist)) {
    await app.register(fastifyStatic, { root: sdkDist, prefix: '/sdk/', decorateReply: true });
  }

  // SDK browser test page (used by the e2e suite; harmless to expose in dev).
  const sdkTest = path.join(repoRoot, 'sdk', 'test');
  if (existsSync(sdkTest)) {
    await app.register(fastifyStatic, { root: sdkTest, prefix: '/sdk-test/', decorateReply: !existsSync(sdkDist) });
  }

  // Serve the built dashboard as the site root, with an SPA fallback for
  // client-side routes. API 404s stay JSON.
  const dashboardDist = path.join(repoRoot, 'dashboard', 'dist');
  const hasDashboard = existsSync(dashboardDist);
  if (hasDashboard) {
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: '/',
      decorateReply: !existsSync(sdkDist) && !existsSync(sdkTest)
    });
  }
  app.setNotFoundHandler((request, reply) => {
    if (hasDashboard && !request.url.startsWith('/api') && !request.url.startsWith('/sdk')) {
      return reply.sendFile('index.html', dashboardDist);
    }
    return reply.code(404).send({ error: 'not found' });
  });

  return app;
}
