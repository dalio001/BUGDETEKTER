# BugDetekter

Self-hosted bug monitoring & reporting with Claude integration. One deployment gives you:

- **Automated error monitoring** (Sentry-style) — a 6.6KB embeddable JS SDK captures uncaught
  exceptions, unhandled promise rejections, console errors, failed network requests, and
  (opt-in) performance problems on your sites, and streams them to your own backend.
- **Issue grouping** — events are fingerprinted server-side (stack shape, normalized messages,
  URLs with volatile ids stripped) so 500 occurrences of one bug show as **one issue** with a
  count, trend, browser breakdown, and affected URLs. Resolved issues reopen automatically if
  the error comes back.
- **Manual bug/feature reporting** — you or your team file reports with descriptions,
  drag-and-drop screenshots, priority, and category. They live in the same issue list, tagged
  `manual`.
- **A live dashboard** — real-time error feed (SSE), trends over time, filtering, status
  tracking (open / in progress / resolved / ignored), and comments.
- **Claude integration (MCP)** — ask Claude *"what bugs are open on my site right now?"* and it
  can list, inspect (including stack traces and screenshots), comment on, resolve, and file
  issues through the bundled MCP server.

## Repository layout

| Folder | What it is | Docs |
|---|---|---|
| [`/sdk`](sdk) | Embeddable browser SDK (vanilla TS → 6.6KB IIFE) | [sdk/README.md](sdk/README.md) |
| [`/backend`](backend) | Fastify + Postgres API: ingest, grouping, reports, auth, SSE feed | [backend/README.md](backend/README.md) |
| [`/dashboard`](dashboard) | React (Vite) dashboard served by the backend | [dashboard/README.md](dashboard/README.md) |
| [`/mcp-server`](mcp-server) | MCP server for Claude Code / Claude Desktop | [mcp-server/README.md](mcp-server/README.md) |
| [`/e2e`](e2e) | Playwright + MCP end-to-end verification suite | below |

```
Browser page ──(SDK batches, sendBeacon/fetch)──▶ POST /api/ingest ─▶ fingerprint ─▶ issues (Postgres)
Dashboard  ◀──(REST + SSE live feed)────────────┤                                        ▲
Claude     ◀──(MCP stdio → REST + API token)────┘        manual reports (+screenshots) ──┘
```

## Quickstart (local, no Docker)

Prereqs: Node 20+, Postgres 14+.

```bash
# 1. database
createuser bugdetekter --pwprompt        # or: CREATE ROLE bugdetekter LOGIN PASSWORD '...'
createdb bugdetekter -O bugdetekter

# 2. install + migrate + seed
npm install
cp backend/.env.example backend/.env      # set DATABASE_URL + real secrets
npm run migrate
npm run seed                              # prints admin login, ingest key, and an API token

# 3. build the SDK and dashboard, then start
npm run build
npm run dev:backend                       # http://localhost:4000
```

Log in at `http://localhost:4000` with the seeded credentials, open **Projects**, and copy the
embed snippet for your site:

```html
<script src="https://your-host/sdk/bugdetekter.min.js"></script>
<script>
  BugDetekter.init({ endpoint: "https://your-host/api/ingest", key: "pk_..." });
</script>
```

Errors on any page carrying that snippet now stream into the **Issues** view live.

### Connect Claude

Create a token under **API tokens**, then (see [mcp-server/README.md](mcp-server/README.md) for
Claude Desktop and more detail):

```bash
claude mcp add bugdetekter \
  -e BUGDETEKTER_URL=http://localhost:4000 \
  -e BUGDETEKTER_TOKEN=bd_... \
  -- npx tsx /path/to/BUGDETEKTER/mcp-server/src/index.ts
```

## Docker

> The compose file is provided for convenience and mirrors the verified local setup, but was
> not itself run in this project's CI environment (no Docker daemon available there).

```bash
docker compose up --build
# first run only, in another terminal:
docker compose exec app npm run migrate
docker compose exec app npm run seed
```

## Verification / e2e suite

With a running backend (and built SDK + dashboard):

```bash
npm test -w backend                    # fingerprint/grouping unit tests
node e2e/sdk-capture.spec.mjs          # real Chromium: triggers every error type, asserts grouping + regression reopen
node e2e/dashboard.spec.mjs            # login → issues → detail → status/comment → manual report with screenshot
node e2e/mcp-drive.mjs                 # drives the MCP server over stdio, all five tools + scope enforcement
```

Set `CHROMIUM_PATH` if Playwright should use a preinstalled browser build.

## Design notes & limitations (v1)

- **Single-owner** deployment: one team, many sites. No public signup/multi-tenancy.
- **Alerts**: dashboard-only (live SSE feed). Email/Slack notifiers are a natural next step —
  the ingest path publishes to an internal event bus they could subscribe to.
- **Ingest is CORS-open by design** and authenticated by the per-project key; it is rate
  limited (600 events/min/key) and size-capped. Ad blockers may block third-party ingest
  domains — self-hosting on the monitored site's own domain avoids most of that.
- **Fingerprinting** survives redeploys of content-hashed bundles (`app.a1b2c3d4.js`), but
  renamed identifiers in re-minified code can still split groups; source-map support is out of
  scope for v1.
- **Storage**: screenshots go to local disk by default (`STORAGE_DIR`); set `STORAGE_DRIVER=s3`
  with the `S3_*` variables for any S3-compatible store. Downloads always go through short-lived
  HMAC-signed URLs.
- **SSE** heartbeats every 15s; the dashboard falls back to 10s polling if a proxy stalls the
  stream.
