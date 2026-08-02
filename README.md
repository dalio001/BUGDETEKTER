# BugDetekter

Self-hosted bug monitoring & reporting with Claude integration:

- **`/sdk`** — embeddable browser SDK (Sentry-style) that captures uncaught exceptions, unhandled promise rejections, console errors, failed network requests, and (opt-in) performance problems.
- **`/backend`** — Fastify + Postgres API that ingests events, groups them into issues by fingerprint, stores manual bug/feature reports with screenshots, and serves the dashboard.
- **`/dashboard`** — React app for the live error feed, trends, issue management, and manual reporting.
- **`/mcp-server`** — MCP server so Claude can list, inspect, comment on, and resolve issues, or file new reports.

> Full setup instructions land in this README as the components are built — see each package's README for details in the meantime.
