# CLAUDE.md — BugDetekter

Cross-session working notes for Claude. Read this first when resuming.

## Keeping this file current
A hook (`.claude/settings.json`) appends every commit to the **Progress log** at the bottom
automatically — that part needs no effort. The hook cannot write prose, so **whenever you finish a
piece of work, update the narrative sections in the same commit**: move finished items from
"Open items" into "Completed", and correct "Status" if it changed. A stale Status is worse than no
Status, because the next session trusts it.

## What this is
Self-hosted, single-owner bug-monitoring tool with Claude integration. npm-workspaces monorepo:
`sdk/` (embeddable browser SDK), `backend/` (Fastify 5 + Postgres), `dashboard/` (React + Vite,
served by the backend), `mcp-server/` (MCP stdio server, 5 tools), `e2e/` (Playwright + MCP drive).

## Status: WORKING & VERIFIED (v1) — being deployed to Railway
Branch `claude/bug-monitoring-reporting-tool-88kw31`, pushed. Verified from a clean clone against
an empty database: migrate/seed, build, boot, and the full journey all pass.
User chose **Railway** for hosting (account created, trial). The repo now supports a shell-less
deploy end to end; the actual Railway build has not run yet — see "Open items".

## Completed
- All spec components: SDK capture (exceptions, rejections, console, network, opt-in perf) with
  batching/sendBeacon; server-side fingerprint grouping + resolved→open regression; manual reports
  with screenshot upload; signed attachment URLs; local + S3 storage drivers; JWT-cookie auth +
  scoped API tokens; SSE live feed w/ polling fallback; status/priority/comments; trend charts;
  MCP server (list_issues, get_issue, create_report, update_issue_status, add_comment).
- Tests: 21 backend unit tests; e2e — SDK capture 14/14, dashboard 14/14, MCP 14/14 (all pass on
  a fresh deployment). Typecheck clean in all 4 workspaces.
- Adversarial code review (4 dimensions) → fixed: SVG stored-XSS, CORS reflect-any-origin, ingest
  timestamp DoS + per-event batch isolation, unbounded rate-limiter map, empty-string enum 500,
  paging total, TrendChart span, search/stats out-of-order races, SDK flush wedge/queue bound.
- Clean-slate install test → fixed a serious bug: `backend/.env` was never loaded (silent dev
  defaults + wrong DB migrated). Now loaded via `process.loadEnvFile`; prod refuses to boot on
  published placeholder secrets; docker-compose requires real secrets.
- Readiness audit (production-ops / doc-accuracy / spec-coverage / real-world-use). See "Open items".
- Deploy hardening: `.dockerignore` (context 188MB→488KB; verified via real Docker that `.env`,
  node_modules, dist and .git no longer enter the image); migrations auto-applied in-process on
  boot behind `MIGRATE_ON_BOOT`, before the port opens; migration runner moved to
  `backend/src/migrate.ts` with a **session** advisory lock (3 concurrent runs previously crashed
  2 of 3 — now all exit 0 with exactly one apply); `restart: unless-stopped` + app healthcheck;
  non-root container with node as PID 1 for real SIGTERM handling; Postgres healthcheck forced to
  TCP (socket check is a false positive during initdb); seed is idempotent for API tokens;
  `start:prod` + `deploy/bugdetekter.service` for the bare-metal path.
- Shell-less deploy (Railway/Fly/…): `SEED_ON_BOOT` creates the first admin + project during boot,
  since managed hosts offer no way to run `npm run seed`. Seed logic moved to `backend/src/seed.ts`
  (advisory-locked, idempotent, never resets an existing password, mints no token so secrets stay
  out of deploy logs); `scripts/seed.ts` is now a thin CLI wrapper that still mints one. Boot
  refuses an unset or published `ADMIN_PASSWORD`. Storage dir is probed for writability at boot and
  warns (not fatal — ingest must survive a bad uploads volume) with the exact chown/UID fix.
  `railway.json` pins the Dockerfile builder + `/api/health` healthcheck. Verified against a fresh
  empty DB booted exactly as Railway will: migrate+seed on boot, login with the env credentials,
  restart is idempotent (1 user/1 project, old password still valid, new env password rejected),
  all three guards refuse, unwritable dir warns while `/api/health` stays 200, e2e 14/14 ×3.

## Open items / next steps (from readiness audit; none block local use)
**Docker images cannot be pulled in this sandbox** — `production.cloudfront.docker.com` is blocked
by egress policy (403), so `docker compose up` has still never been executed end-to-end. Everything
it depends on was verified another way (see above + the fallback prod-mode boot), but the first real
`docker compose up --build` on an unrestricted network remains unproven. **The Railway deploy is
therefore also the Dockerfile's first real build** — watch the build/deploy logs and expect one fix
round. Two known unknowns there: whether the platform routes to a process bound on `0.0.0.0` (our
default; if the deploy is unreachable, try `HOST=::` — note `::` fails in *this* sandbox with
EAFNOSUPPORT, no IPv6, so it could not be tested here), and volume ownership vs. the non-root `node`
user (boot now warns with the fix).

**Flaky e2e assertion (pre-existing, not a regression):** `dashboard.spec.mjs` "issues list renders
rows" failed once with `rows=0` immediately after a fresh ingest, then passed 3/3 on retry — the
list momentarily re-renders empty when a live-feed update lands during initial load. A real (minor)
UI race worth fixing in the Issues page. Note the whole e2e suite assumes a *fresh* database: on the
long-lived dev DB, `event_count=2` and the 7d occurrence chart both fail purely from accumulated /
aged data, not from bugs.

Blockers for a public deployment: data retention/prune (events grow forever); noise filtering
(`Script error.`/extensions/bots), and make `ignored` truly mute (new events still bump ignored
issues today).
High value: source-map support (minified prod stacks are unreadable — biggest UX gap); first-class
release/version tagging; let Claude see screenshot bytes (MCP returns URLs only); DB+uploads
backups; async password hashing (login uses sync scryptSync → event-loop DoS); doc fixes (Node
≥20.12, citext+pgcrypto, Playwright install, e2e env vars); revisit 600/min/key ingest cap; bulk
triage + stack-content search; real user identity.
Optional image slimming: move `tsx` to `dependencies` + `npm prune --omit=dev` in the build stage
(~90MB of build/test-only deps). Deliberately deferred — untestable here without image pulls.

## Key decisions / caveats
- Single-owner (not multi-tenant); dashboard-only alerts (no email/Slack); Claude has read+write.
- Backend runs TypeScript directly via `tsx` (no build step); only SDK + dashboard build.
- DB access is `pg` + hand-written SQL migrations (no ORM) — deliberate, fully verifiable.
- Secrets: dev warns & boots on defaults; `NODE_ENV=production` refuses published placeholders.
- Env: `backend/.env` auto-loaded; real env vars override it; `BUGDETEKTER_ENV_FILE` relocates it.
- v1 scope explicitly excludes source maps — noted in README.

## Run / verify (this environment)
- Postgres: `service postgresql start` (role+db `bugdetekter`). `npm install` at root.
- `npm run migrate -w backend && npm run seed -w backend` (prints admin creds, ingest key, token).
- Backend: `npm run dev:backend`. Build SDK+dashboard: `npm run build`.
- Tests: `npm test -w backend`. E2E (needs backend up): `CHROMIUM_PATH=/opt/pw-browsers/chromium
  node e2e/sdk-capture.spec.mjs` (also `dashboard.spec.mjs`, `mcp-drive.mjs`).
- Git: develop on `claude/bug-monitoring-reporting-tool-88kw31`; push `-u origin` w/ backoff.

## Progress log
<!-- Appended automatically by the PostToolUse hook in .claude/settings.json. Newest last. -->
- chore: scaffold npm-workspaces monorepo — `79ad0c9` (2026-08-02)
- feat(backend): Fastify skeleton, Postgres schema, migration runner, seed script — `10d27e7` (2026-08-02)
- feat(backend): dashboard auth (JWT cookie) and scoped API tokens — `9833d17` (2026-08-02)
- feat(backend): ingest endpoint with fingerprinting, issue grouping, regression reopen — `529498c` (2026-08-02)
- feat(backend): issues/reports/comments/stats APIs, storage drivers, signed URLs, SSE feed — `2d3d96e` (2026-08-02)
- feat(sdk): embeddable browser SDK with error/rejection/console/network/perf capture — `c43c2ac` (2026-08-02)
- feat(dashboard): Vite/React app — login, projects, live issues list, issue detail — `9f48be3` (2026-08-02)
- feat(dashboard): manual report form with image dropzone, overview trends, token management — `38e97bd` (2026-08-02)
- feat(mcp): MCP stdio server exposing five issue tools for Claude — `0acca75` (2026-08-02)
- docs: root + per-component READMEs, Dockerfile, docker-compose — `0625b00` (2026-08-02)
- test(e2e): browser SDK capture, dashboard flow, and MCP drive suites — `df561f4` (2026-08-02)
- fix(security): block stored-XSS via SVG attachments and tighten CORS — `0f55c0b` (2026-08-02)
- fix: harden ingest against hostile input; fix paging, chart span and UI races — `6377166` (2026-08-02)
- fix(config): actually load backend/.env and refuse to run on published secrets — `6a541f5` (2026-08-02)
- docs: add CLAUDE.md cross-session progress tracker — `ce5c725` (2026-08-02)
- build(docker): harden the deploy path — build context, auto-migrate, supervision — `f488c63` (2026-08-02)
- docs: production deployment guide, systemd unit, tracker update — `ec8bdb0` (2026-08-02)
- chore(claude): auto-log every commit to the CLAUDE.md progress log — `02921ca` (2026-08-02)
- docs: log the progress-hook commit — `e37772a` (2026-08-02)
- docs: progress log entry for e37772a (written by the hook itself) — `8ca73d2` (2026-08-02)
- fix(claude): stop the progress hook feeding itself — `a64026e` (2026-08-02)
