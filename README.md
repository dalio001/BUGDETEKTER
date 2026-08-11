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
#    generate secrets with: openssl rand -hex 32
npm run migrate
npm run seed                              # prints admin login, ingest key, and an API token

# 3. build the SDK and dashboard, then start
npm run build
npm run dev:backend                       # http://localhost:4000
```

`backend/.env` is read automatically at startup; real environment variables (from Docker,
systemd, your shell) take precedence over it. **Set `JWT_SECRET` and `SIGNING_SECRET` before
exposing this publicly** — the built-in defaults are in this repository, so anyone could forge a
session with them. Running with `NODE_ENV=production` refuses to start until you do.

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

## Production deployment

**Before you deploy:** generate real `JWT_SECRET` and `SIGNING_SECRET` values — with
`NODE_ENV=production` the app refuses to start on the placeholders shipped in this repo. Put a
TLS terminator (nginx, Caddy, Traefik) in front and set `COOKIE_SECURE=true`.

**Migrations run automatically on boot** in the paths below (`MIGRATE_ON_BOOT=true`), before the
port opens — so a healthy `/api/health` means the schema is current. The runner takes a Postgres
advisory lock, so several instances starting at once is safe. `npm run migrate` remains available
for running them by hand.

### Railway (or any host without shell access)

Managed hosts build the `Dockerfile` for you but give you nowhere to run `npm run seed`, so the
first admin account has to be created during boot instead:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres service) |
| `JWT_SECRET`, `SIGNING_SECRET` | 64 random hex chars each — the app refuses to start on the repo's placeholders |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the login you want; the account is created from these |
| `SEED_ON_BOOT` | `true` |
| `COOKIE_SECURE` | `true` (the host terminates TLS) |
| `STORAGE_DIR` | `/data/uploads`, matching a mounted volume |

`NODE_ENV`, `MIGRATE_ON_BOOT` and the start command already come from the `Dockerfile`; leave
`PORT` to the platform. [`railway.json`](railway.json) points the platform healthcheck at
`/api/health` so a broken deploy fails instead of going live.

`SEED_ON_BOOT` is idempotent and safe to leave on: it never duplicates the user, project, or token,
and it **never resets an existing admin's password** — so changing `ADMIN_PASSWORD` later does
*not* rotate the credential (and cannot be used to recover a forgotten one; do that in the
database). Unlike `npm run seed` it mints no API token, to keep secrets out of the platform's
deploy logs — create one in the dashboard under **API tokens**.

Attachment uploads need a writable volume. Hosts commonly mount volumes owned by `root` while this
image runs as the non-root `node` user; the app checks at boot and logs exactly what to do if the
directory is not writable (on Railway, setting `RAILWAY_RUN_UID=0` runs the container as root).
Error capture keeps working either way — only uploads fail.

### Docker Compose

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export SIGNING_SECRET=$(openssl rand -hex 32)
export ADMIN_PASSWORD='pick-something-strong'

docker compose up --build --wait      # --wait fails loudly instead of crash-looping

# once, to create the admin user + first project:
docker compose exec app node --import tsx backend/scripts/seed.ts
```

The seed prints the admin login, the project's ingest key, and an API token for Claude. It is safe
to re-run: it will not duplicate the user, project, or token.

Both services use `restart: unless-stopped`, and the app has a healthcheck, so a crash or a host
reboot brings it back. The container runs as the non-root `node` user; a *fresh* named volume
inherits that ownership. If you ever mount a pre-existing root-owned uploads volume, screenshot
uploads fail with `EACCES` — fix with:

```bash
docker compose run --rm --user root app chown -R node:node /data/uploads
```

### Bare metal / VPS (systemd)

```bash
sudo useradd --system --home /opt/bugdetekter bugdetekter
sudo git clone <this-repo> /opt/bugdetekter && cd /opt/bugdetekter

# NOTE: do NOT set NODE_ENV=production for the install — tsx (the runtime) and
# vite/esbuild (the build) are devDependencies and would be skipped.
sudo -u bugdetekter npm ci
sudo -u bugdetekter npm run build

sudo -u bugdetekter cp backend/.env.example backend/.env   # fill in secrets + DATABASE_URL
#   also set STORAGE_DIR=/var/lib/bugdetekter/uploads to match the unit file

sudo cp deploy/bugdetekter.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bugdetekter
journalctl -u bugdetekter -f
```

[`deploy/bugdetekter.service`](deploy/bugdetekter.service) documents the traps (systemd's
`EnvironmentFile` is not a shell; nvm-installed Node will not work; `ProtectSystem=strict` needs
`StateDirectory`).

### Not handled yet (v1)

No event retention/pruning (the `events` table grows forever), no automated backups for the
database or uploads volume, and no built-in TLS. See `CLAUDE.md` for the full open-items list.

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
