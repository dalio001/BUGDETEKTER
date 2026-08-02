# CLAUDE.md — BugDetekter

Cross-session working notes for Claude. Read this first when resuming.

## What this is
Self-hosted, single-owner bug-monitoring tool with Claude integration. npm-workspaces monorepo:
`sdk/` (embeddable browser SDK), `backend/` (Fastify 5 + Postgres), `dashboard/` (React + Vite,
served by the backend), `mcp-server/` (MCP stdio server, 5 tools), `e2e/` (Playwright + MCP drive).

## Status: WORKING & VERIFIED (v1)
Branch `claude/bug-monitoring-reporting-tool-88kw31`, pushed. Verified from a clean clone against
an empty database: migrate/seed, build, boot, and the full journey all pass.

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

## Open items / next steps (from readiness audit; none block local use)
Blockers for a public deployment: add `.dockerignore`; actually run the Docker path; auto-run
migrations on deploy + a documented prod start command; data retention/prune (events grow forever);
process supervision/restart; noise filtering (`Script error.`/extensions/bots), and make `ignored`
truly mute (new events still bump ignored issues today).
High value: source-map support (minified prod stacks are unreadable — biggest UX gap); first-class
release/version tagging; let Claude see screenshot bytes (MCP returns URLs only); DB+uploads
backups; document TLS + `COOKIE_SECURE=true`; async password hashing (login uses sync scryptSync →
event-loop DoS); doc fixes (Node ≥20.12, citext+pgcrypto, Playwright install, e2e env vars); revisit
600/min/key ingest cap; bulk triage + stack-content search; real user identity.

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
