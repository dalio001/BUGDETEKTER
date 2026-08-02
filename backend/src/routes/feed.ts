import type { FastifyInstance } from 'fastify';
import { isUuid } from '../util.js';

const HEARTBEAT_MS = 15_000;

export function registerFeedRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { project_id?: string } }>(
    '/api/feed',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const projectId = request.query.project_id;
      if (projectId && !isUuid(projectId)) return reply.code(400).send({ error: 'invalid project_id' });

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Tell nginx-style proxies not to buffer the stream.
        'x-accel-buffering': 'no'
      });
      reply.raw.write('retry: 5000\n\n');

      const unsubscribe = app.feed.subscribe((event) => {
        if (projectId && event.project_id !== projectId) return;
        reply.raw.write(`event: issue_update\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Named event (not an SSE comment) so EventSource clients can watch for
      // liveness and fall back to polling when a proxy swallows the stream.
      const heartbeat = setInterval(() => {
        reply.raw.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`);
      }, HEARTBEAT_MS);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );
}
