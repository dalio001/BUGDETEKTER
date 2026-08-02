import { createHash } from 'node:crypto';

export type EventType = 'exception' | 'unhandled_rejection' | 'console_error' | 'network_error' | 'performance';

export interface IngestEvent {
  type: EventType;
  message?: string;
  stack?: string;
  error_type?: string;
  url?: string;
  timestamp?: number;
  session_id?: string;
  meta?: Record<string, unknown>;
}

export interface StackFrame {
  fn: string;
  file: string;
  line?: number;
  col?: number;
}

const SDK_FILE_RE = /bugdetekter(\.min|\.esm)?\.js/i;

/** Parse a browser stack trace. Handles V8 ("at fn (file:1:2)") and Firefox/Safari ("fn@file:1:2"). */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let fn = '';
    let loc = '';
    let m = line.match(/^at\s+(?:async\s+)?(?:new\s+)?(.+?)\s+\((.+)\)$/);
    if (m) {
      fn = m[1]!;
      loc = m[2]!;
    } else if ((m = line.match(/^at\s+(?:async\s+)?(.+)$/))) {
      loc = m[1]!;
    } else if ((m = line.match(/^(.*?)@(.+)$/))) {
      fn = m[1]!;
      loc = m[2]!;
    } else {
      continue; // message line or unrecognized format
    }

    let lineNo: number | undefined;
    let colNo: number | undefined;
    let file = loc;
    const lc = file.match(/:(\d+):(\d+)$/);
    if (lc) {
      lineNo = Number(lc[1]);
      colNo = Number(lc[2]);
      file = file.slice(0, -lc[0].length);
    } else {
      const l = file.match(/:(\d+)$/);
      if (l) {
        lineNo = Number(l[1]);
        file = file.slice(0, -l[0].length);
      }
    }

    frames.push({ fn: fn.trim(), file, line: lineNo, col: colNo });
  }
  return frames;
}

/**
 * Normalize a source file path for grouping: strip origin, query/hash, and
 * content-hash segments in the filename so `app.a1b2c3d4.js` and
 * `app.ffee0011.js` (same bundle, different deploy) group together.
 */
export function normFile(file: string): string {
  let f = file.trim();
  f = f.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); // protocol + host
  f = f.replace(/[?#].*$/, '');
  f = f.replace(/([.-])[0-9a-f]{8,}(?=\.[a-z0-9]+$)/i, '$1<hash>');
  return f || '<anonymous>';
}

/** Normalize a message: volatile values (URLs, UUIDs, hex ids, numbers) become placeholders. */
export function normMsg(message: string): string {
  return message
    .slice(0, 500)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'")]+/gi, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reduce a URL to a normalized path (no origin/query/hash, ids replaced) for grouping. */
export function normUrlPath(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
  }
  return (
    path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
      .replace(/\d+/g, '<n>') || '/'
  );
}

function topFrames(stack: string | undefined, count: number): string[] {
  if (!stack) return [];
  return parseStack(stack)
    .filter((f) => !SDK_FILE_RE.test(f.file))
    .slice(0, count)
    .map((f) => `${f.fn || '<anonymous>'}@${normFile(f.file)}`);
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface Fingerprinted {
  fingerprint: string;
  title: string;
  errorType: string | null;
}

/** Compute the grouping fingerprint and display title for an auto-captured event. */
export function fingerprintEvent(event: IngestEvent): Fingerprinted {
  const message = event.message ?? '';
  const meta = event.meta ?? {};

  switch (event.type) {
    case 'exception':
    case 'unhandled_rejection': {
      const errorType = event.error_type || 'Error';
      const parts = [event.type, errorType, normMsg(message), ...topFrames(event.stack, 5)];
      const prefix = event.type === 'unhandled_rejection' ? 'Unhandled rejection: ' : '';
      return {
        fingerprint: hash(parts),
        title: truncate(`${prefix}${errorType}: ${message || '(no message)'}`, 200),
        errorType
      };
    }
    case 'console_error': {
      const parts = ['console', normMsg(message.slice(0, 300)), ...topFrames(event.stack, 1)];
      return {
        fingerprint: hash(parts),
        title: truncate(`Console error: ${message || '(empty)'}`, 200),
        errorType: null
      };
    }
    case 'network_error': {
      const method = String(meta.method ?? 'GET').toUpperCase();
      const status = Number(meta.status ?? 0);
      const requestUrl = String(meta.request_url ?? message);
      const path = normUrlPath(requestUrl);
      const statusLabel = status > 0 ? `HTTP ${status}` : 'network failure';
      return {
        fingerprint: hash(['network', method, String(status), path]),
        title: truncate(`${method} ${path} → ${statusLabel}`, 200),
        errorType: null
      };
    }
    case 'performance': {
      const metric = String(meta.metric ?? 'slow_load');
      const path = normUrlPath(event.url ?? '');
      const label = metric === 'long_task' ? 'Long tasks' : 'Slow page load';
      return {
        fingerprint: hash(['perf', metric, path]),
        title: truncate(`${label}: ${path}`, 200),
        errorType: null
      };
    }
  }
}
