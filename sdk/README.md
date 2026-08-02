# BugDetekter SDK

Zero-dependency browser SDK. Builds to a 6.6KB (2.9KB gzip) IIFE plus an ESM bundle.

```bash
npm run build   # dist/bugdetekter.min.js + dist/bugdetekter.esm.js (esbuild, es2018)
```

## Embed

```html
<script src="https://your-host/sdk/bugdetekter.min.js"></script>
<script>
  BugDetekter.init({
    endpoint: "https://your-host/api/ingest",
    key: "pk_your_project_key",
    // optional:
    capture: { console: true, network: true, performance: false },
    slowLoadThreshold: 3000,     // ms; emits a performance event above this
    ignoreUrls: ["/analytics"],  // substrings or RegExp, excluded from network capture
    sampleRate: 1,               // fraction of sessions monitored
    metadata: { release: "1.4.2" }
  });
</script>
```

ESM: `import { init, captureException, captureMessage, flush } from './bugdetekter.esm.js'`.

## What it captures

| Signal | How |
|---|---|
| Uncaught exceptions | `window` `error` event (message, type, stack) |
| Unhandled promise rejections | `unhandledrejection` |
| Console errors | `console.error` patch (original always called first; reentrancy-guarded) |
| Failed requests | `fetch` + `XMLHttpRequest` patches: network failures (status 0) and HTTP ≥ 400, with method/URL/duration; failed `<script>`/`<img>`/`<link>` loads |
| Performance (opt-in) | slow full-page loads (Navigation Timing) and long-task summaries (≤1 event/30s) |

Every event carries the page URL, timestamp, a per-tab session id (sessionStorage), and the
user agent (parsed server-side into browser/OS/device).

## Delivery

Events are queued and flushed in batches (5s timer, 20-event cap, or `pagehide`/tab-hide via
`navigator.sendBeacon`). Batches stay under 55KB with stacks truncated at 8KB, and identical
events are dropped past 10/minute (error-loop protection). Requests post as `text/plain`
(CORS-simple, so no preflight), and calls to the ingest endpoint itself are never captured —
the SDK cannot report its own reporting.

## Manual API

```js
BugDetekter.captureException(err, { orderId: 123 });
BugDetekter.captureMessage("Payment widget fell back to iframe mode");
BugDetekter.flush();
```

`test/testpage.html` exercises every capture path (used by `e2e/sdk-capture.spec.mjs`).
