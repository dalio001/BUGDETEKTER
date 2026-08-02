import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyAttachmentSig } from '../security.js';
import { isUuid } from '../util.js';
import { ALLOWED_IMAGE_TYPES, saveAttachments } from './reports.js';

export function registerAttachmentRoutes(app: FastifyInstance): void {
  // Signed, expiring URL — the signature is the auth, so <img> tags and
  // Claude clients can fetch without a session.
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/api/attachments/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { exp, sig } = request.query;
      if (!isUuid(id) || !exp || !sig) return reply.code(400).send({ error: 'invalid attachment request' });
      if (!verifyAttachmentSig(id, Number(exp), sig, app.config.signingSecret)) {
        return reply.code(403).send({ error: 'invalid or expired signature' });
      }
      const { rows } = await app.db.query(
        `SELECT filename, mime_type, storage_key FROM attachments WHERE id = $1`,
        [id]
      );
      const attachment = rows[0];
      if (!attachment) return reply.code(404).send({ error: 'attachment not found' });

      const stream = await app.storage.getStream(attachment.storage_key);
      stream.on('error', () => {
        if (!reply.sent) void reply.code(404).send({ error: 'attachment data missing' });
      });
      // Uploads are restricted to raster images, but serve them defensively
      // anyway: never sniff, never script, and only render inline for types
      // we know are inert.
      const contentType = ALLOWED_IMAGE_TYPES.has(attachment.mime_type)
        ? attachment.mime_type
        : 'application/octet-stream';
      const disposition = ALLOWED_IMAGE_TYPES.has(attachment.mime_type) ? 'inline' : 'attachment';
      return reply
        .header('content-type', contentType)
        .header('content-disposition', `${disposition}; filename="${attachment.filename}"`)
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(stream);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/issues/:id/attachments',
    { preHandler: app.requireWrite },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(400).send({ error: 'invalid issue id' });
      if (!request.isMultipart()) return reply.code(400).send({ error: 'multipart body expected' });

      const issue = await app.db.query(`SELECT id FROM issues WHERE id = $1`, [id]);
      if (issue.rows.length === 0) return reply.code(404).send({ error: 'issue not found' });

      const files: Array<{ filename: string; mimeType: string; data: Buffer }> = [];
      for await (const part of request.parts()) {
        if (part.type === 'file' && ALLOWED_IMAGE_TYPES.has(part.mimetype) && files.length < 5) {
          files.push({ filename: part.filename ?? 'image', mimeType: part.mimetype, data: await part.toBuffer() });
        } else if (part.type === 'file') {
          await part.toBuffer();
        }
      }
      if (files.length === 0) {
        return reply.code(400).send({ error: 'no supported image files provided (png, jpeg, gif, webp)' });
      }

      const attachments = await saveAttachments(app, id, files);
      return reply.code(201).send({ attachments });
    }
  );
}
