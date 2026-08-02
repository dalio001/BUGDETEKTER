import type { EmitFn } from './capture.js';

const LONGTASK_SUMMARY_INTERVAL_MS = 30_000;

export function installPerfCapture(emit: EmitFn, slowLoadThreshold: number): void {
  // Slow full-page load, measured once the load event has finished.
  const checkLoad = () => {
    setTimeout(() => {
      try {
        const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (nav && nav.loadEventEnd > 0 && nav.loadEventEnd > slowLoadThreshold) {
          emit('performance', `Slow page load: ${Math.round(nav.loadEventEnd)}ms`, {
            meta: {
              metric: 'slow_load',
              value: Math.round(nav.loadEventEnd),
              ttfb: Math.round(nav.responseStart),
              dom_content_loaded: Math.round(nav.domContentLoadedEventEnd)
            }
          });
        }
      } catch {
        // performance API unavailable
      }
    }, 0);
  };
  if (document.readyState === 'complete') checkLoad();
  else window.addEventListener('load', checkLoad);

  // Long tasks, aggregated into at most one summary event per 30s window.
  try {
    let count = 0;
    let totalMs = 0;
    let maxMs = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        count += 1;
        totalMs += entry.duration;
        maxMs = Math.max(maxMs, entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    setInterval(() => {
      if (count === 0) return;
      emit('performance', `${count} long task(s), max ${Math.round(maxMs)}ms`, {
        meta: { metric: 'long_task', count, total_ms: Math.round(totalMs), max_ms: Math.round(maxMs) }
      });
      count = 0;
      totalMs = 0;
      maxMs = 0;
    }, LONGTASK_SUMMARY_INTERVAL_MS);
  } catch {
    // longtask observation unsupported in this browser
  }
}
