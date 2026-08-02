import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isUuid } from '../util.js';
import { attachmentUrl } from './issues.js';

const MAX_FILES = 5;

interface ReportFields {
  project_id?: string;
  title?: string;
  description?: string;
  priority?: string;
  category?: string;
  page_url?: string;
}

interface UploadedFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

async function readMultipart(request: FastifyRequest): Promise<{ fields: ReportFields; files: UploadedFile[] }> {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (files.length >= MAX_FILES) {
        await part.toBuffer(); // drain so the stream can finish
        continue;
      }
      if (!part.mimetype.startsWith('image/')) {
        await part.toBuffer();
        continue;
      }
      files.push({ filename: part.filename ?? 'screenshot', mimeType: part.mimetype, data: await part.toBuffer() });
    } else {
      fields[part.fieldname] = String(part.value).slice(0, 20_000);
    }
  }
  return { fields: fields as ReportFields, files };
}

export async function saveAttachments(
  app: FastifyInstance,
  issueId: string,
  files: UploadedFile[]
): Promise<Array<{ id: string; filename: string; mime_type: string; size_bytes: number; url: string }>> {
  const saved = [];
  for (const file of files) {
    const id = randomUUID();
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const storageKey = `${issueId}/${id}-${safeName}`;
    await app.storage.put(storageKey, file.data, file.mimeType);
    const { rows } = await app.db.query(
      `INSERT INTO attachments (id, issue_id, filename, mime_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, mime_type, size_bytes`,
      [id, issueId, safeName, file.mimeType, file.data.length, storageKey]
    );
    saved.push({ ...rows[0], url: attachmentUrl(app, id) });
  }
  return saved;
}

export function registerReportRoutes(app: FastifyInstance): void {
  app.post('/api/reports', { preHandler: app.requireWrite }, async (request, reply) => {
    let fields: ReportFields;
    let files: UploadedFile[] = [];

    if (request.isMultipart()) {
      ({ fields, files } = await readMultipart(request));
    } else {
      fields = (request.body ?? {}) as ReportFields;
    }

    if (!fields.project_id || !isUuid(fields.project_id)) {
      return reply.code(400).send({ error: 'project_id (uuid) is required' });
    }
    if (!fields.title?.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }
    if (fields.priority && !['low', 'medium', 'high', 'critical'].includes(fields.priority)) {
      return reply.code(400).send({ error: 'invalid priority' });
    }
    if (fields.category && !['bug', 'feature'].includes(fields.category)) {
      return reply.code(400).send({ error: 'invalid category' });
    }

    const project = await app.db.query(`SELECT id FROM projects WHERE id = $1`, [fields.project_id]);
    if (project.rows.length === 0) return reply.code(404).send({ error: 'project not found' });

    // Manual reports never group with anything: fingerprint is a fresh uuid.
    const { rows } = await app.db.query(
      `INSERT INTO issues (project_id, fingerprint, source, title, description, priority, category, page_url, event_count)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, 0)
       RETURNING id, project_id, source, status, title, description, priority, category, page_url, event_count, first_seen, last_seen, created_at`,
      [
        fields.project_id,
        `manual:${randomUUID()}`,
        fields.title.trim().slice(0, 200),
        fields.description ?? null,
        fields.priority ?? null,
        fields.category ?? null,
        fields.page_url?.slice(0, 2000) ?? null
      ]
    );
    const issue = rows[0];

    const attachments = await saveAttachments(app, issue.id, files);

    await app.db.query(
      `INSERT INTO comments (issue_id, user_id, author_label, kind, body)
       VALUES ($1, $2, $3, 'comment', $4)`,
      [issue.id, request.auth!.userId, request.auth!.authorLabel, `Report created by ${request.auth!.authorLabel}`]
    );

    app.feed.publish({
      issue_id: issue.id,
      project_id: issue.project_id,
      title: issue.title,
      status: issue.status,
      source: 'manual',
      event_count: 0,
      last_seen: new Date(issue.last_seen).toISOString(),
      kind: 'created'
    });

    return reply.code(201).send({ issue, attachments });
  });
}
