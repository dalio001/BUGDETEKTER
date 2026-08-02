import type { SdkEvent } from './types.js';

export const SDK_VERSION = '0.1.0';

const MAX_STACK_CHARS = 8_000;
const MAX_BATCH_BYTES = 55_000; // stay safely under sendBeacon's 64KB budget
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_PER_WINDOW = 10;

export class Transport {
  private queue: SdkEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seen = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private endpoint: string,
    private key: string,
    private flushInterval: number,
    private maxBatch: number
  ) {
    const flushOnHide = () => this.flush(true);
    window.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  enqueue(event: SdkEvent): void {
    if (this.isBurstDuplicate(event)) return;
    if (event.stack && event.stack.length > MAX_STACK_CHARS) {
      event.stack = event.stack.slice(0, MAX_STACK_CHARS);
    }
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  /** Drop identical events arriving faster than 10/minute (error loops, render storms). */
  private isBurstDuplicate(event: SdkEvent): boolean {
    const dedupKey = `${event.type}|${event.message.slice(0, 200)}|${(event.stack ?? '').slice(0, 200)}`;
    const now = Date.now();
    const entry = this.seen.get(dedupKey);
    if (!entry || now - entry.windowStart > DEDUP_WINDOW_MS) {
      this.seen.set(dedupKey, { count: 1, windowStart: now });
      if (this.seen.size > 200) this.seen.clear(); // bound memory
      return false;
    }
    entry.count += 1;
    return entry.count > DEDUP_MAX_PER_WINDOW;
  }

  flush(unloading = false): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      const batch: SdkEvent[] = [];
      let size = 100; // envelope overhead
      while (this.queue.length > 0 && batch.length < this.maxBatch) {
        const next = this.queue[0]!;
        const nextSize = JSON.stringify(next).length;
        if (batch.length > 0 && size + nextSize > MAX_BATCH_BYTES) break;
        batch.push(this.queue.shift()!);
        size += nextSize;
      }
      this.send(JSON.stringify({ key: this.key, sdk: SDK_VERSION, events: batch }), unloading);
    }
  }

  private send(body: string, unloading: boolean): void {
    // text/plain keeps this a CORS "simple request" — no preflight from any origin.
    if (unloading && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'text/plain' }))) return;
      } catch {
        // fall through to fetch
      }
    }
    try {
      void fetch(this.endpoint, {
        method: 'POST',
        body,
        keepalive: true,
        mode: 'cors',
        headers: { 'content-type': 'text/plain' }
      }).catch(() => {});
    } catch {
      // never let reporting break the host page
    }
  }
}
