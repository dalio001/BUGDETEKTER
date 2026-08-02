# BugDetekter dashboard

React 18 + Vite + react-router. Plain CSS (dark theme), hand-rolled SVG charts — no UI or
chart dependencies.

```bash
npm run dev     # vite on :5173, proxies /api and /sdk to :4000
npm run build   # dashboard/dist — served by the backend at /
```

Pages:

- **Overview** — stat cards, events-over-time chart (24h/7d/30d, per project), most active issues.
- **Issues** — live feed (SSE with polling fallback), filters for project / status / source
  (auto vs manual) / search / sort, per-issue 24h sparklines.
- **Issue detail** — status & priority controls, occurrence trend, parsed stack trace,
  browser + affected-URL breakdowns, recent events, screenshots, comments/activity (including
  system entries for status changes and regressions).
- **Report a bug** — manual report form with drag-and-drop screenshot upload.
- **Projects** — add sites, copy the embed snippet (includes the ingest key).
- **API tokens** — mint/revoke scoped tokens for the MCP server (admin only).

Auth is a httpOnly session cookie; the dashboard is served from the same origin as the API so
no CORS or token storage is involved.
