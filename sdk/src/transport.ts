import type { SdkEvent } from './types.js';

export const SDK_VERSION = '0.1.0';

const MAX_STACK_CHARS = 8_000;
const MAX_BATCH_BYTES = 55_000; // stay safely under sendBeacon's 64KB budget
const MAX_QUEUED_EVENTS = 200;
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_PER_WINDOW = 10;

/** UTF-8 byte length — the beacon budget is bytes, not UTF-16 code units. */
function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

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
    // Bound memory on a long-lived page whose ingest endpoint is unreachable
    // (offline, blocked): keep the newest events, drop the oldest.
    if (this.queue.length >= MAX_QUEUED_EVENTS) this.queue.shift();
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
        // User-supplied metadata can be circular or throw in toJSON; such an
        // event is dropped rather than wedging the queue forever.
        let nextSize: number;
        try {
          nextSize = byteLength(JSON.stringify(next));
        } catch {
          this.queue.shift();
          continue;
        }
        if (batch.length > 0 && size + nextSize > MAX_BATCH_BYTES) break;
        batch.push(this.queue.shift()!);
        size += nextSize;
      }
      if (batch.length === 0) continue;
      try {
        this.send(JSON.stringify({ key: this.key, sdk: SDK_VERSION, events: batch }), unloading);
      } catch {
        // serialization failed for the batch as a whole — drop it
      }
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
