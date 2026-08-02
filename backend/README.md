# BugDetekter backend

Fastify 5 + Postgres. Ingests SDK events, groups them into issues by fingerprint, stores manual
reports with screenshots, and serves the built dashboard + SDK as static files.

## Run

```bash
npm run migrate    # applies migrations/*.sql (tracked in _migrations)
npm run seed       # admin user, demo project + ingest key, write-scope API token
npm run dev        # tsx watch src/server.ts  (or: npm start)
npm test           # fingerprint/grouping unit tests
```

Configuration is environment-driven — see [.env.example](.env.example). `tsx` runs the
TypeScript directly; there is no build step for the server.

## How grouping works

`src/fingerprint.ts` (pure, unit-tested) hashes per-type material:

- **exception / unhandled_rejection** — event type + error type + normalized message + top 5
  stack frames (`fn@file`, origin/query/line/col stripped, content-hash filename segments like
  `app.a1b2c3d4.js` → `app.<hash>.js`).
- **console_error** — normalized first 300 chars + top frame.
- **network_error** — method + status + URL path with ids/uuids/hex replaced by placeholders.
- **performance** — metric + page path.
- **manual reports** — a fresh uuid, so they never group.

Messages are normalized (URLs, UUIDs, hex ids, and numbers become placeholders) so
`Failed to load user 42` and `Failed to load user 977` are one issue.

Ingest upserts the issue in a single round trip (`ON CONFLICT ... DO UPDATE`), bumping
`event_count`/`last_seen`. **Regression rule:** an event matching a `resolved` issue reopens it
and records a system comment; `ignored` issues stay muted.

## API surface

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/ingest` | ingest key | SDK event batches (text/plain or JSON), 202, rate limited |
| `POST /api/auth/login` / `logout` / `GET me` | — / cookie | dashboard session (httpOnly JWT cookie) |
| `GET/POST /api/projects`, `GET /:id` | cookie/token | projects + embed snippet |
| `GET /api/issues` | cookie/token | filters: project_id, status, source, search, sort; paged; 24h sparklines |
| `GET /api/issues/:id` | cookie/token | detail + browser/URL aggregates + latest stack + attachments |
| `PATCH /api/issues/:id` | write | status/priority/category (+ status_change comment) |
| `GET /api/issues/:id/events` | cookie/token | paged occurrences |
| `GET/POST /api/issues/:id/comments` | cookie/token / write | notes + system entries |
| `POST /api/reports` | write | manual report, JSON or multipart (≤5 images, ≤5MB each) |
| `POST /api/issues/:id/attachments` | write | append screenshots |
| `GET /api/attachments/:id?exp&sig` | signed URL | streams image (HMAC, 1h expiry) |
| `GET /api/stats/overview`, `GET /api/issues/:id/stats` | cookie/token | time-bucketed trends |
| `GET /api/feed` | cookie/token | SSE live feed (`issue_update` + `ping` heartbeats) |
| `GET/POST/DELETE /api/tokens` | admin | scoped API tokens (`read`/`write`), value shown once |

API tokens are sent as `Authorization: Bearer bd_...` and stored as sha256 hashes.

## Storage drivers

`STORAGE_DRIVER=local` (default) writes under `STORAGE_DIR`; `s3` lazily loads
`@aws-sdk/client-s3` and works with AWS S3 / MinIO / R2 (`S3_ENDPOINT`,
`S3_FORCE_PATH_STYLE=true` for MinIO). Attachment downloads are always brokered through the
backend with signed URLs, so bucket contents stay private.
