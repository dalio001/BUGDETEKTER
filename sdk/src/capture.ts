import type { SdkEvent } from './types.js';

export type EmitFn = (
  type: SdkEvent['type'],
  message: string,
  extras?: { stack?: string; error_type?: string; meta?: Record<string, unknown> }
) => void;

const SDK_FILE_RE = /bugdetekter(\.min|\.esm)?\.js/;

function stripSdkFrames(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => !SDK_FILE_RE.test(line))
    .join('\n');
}

function safeString(value: unknown, max = 300): string {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value.slice(0, max);
    if (typeof value === 'object' && value !== null) return JSON.stringify(value).slice(0, max);
    return String(value).slice(0, max);
  } catch {
    return '[unserializable]';
  }
}

// --- Uncaught exceptions + failed resource loads ---

export function installErrorCapture(emit: EmitFn): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error;
    if (error instanceof Error) {
      emit('exception', error.message, { stack: error.stack, error_type: error.name });
    } else {
      emit('exception', event.message || 'Unknown error', {
        error_type: 'Error',
        meta: { file: event.filename, line: event.lineno, col: event.colno }
      });
    }
  });

  // Resource load failures (script/img/link/audio/video) only fire in the
  // capture phase and have a non-window target.
  window.addEventListener(
    'error',
    (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === (window as unknown) || !('tagName' in target)) return;
      const source =
        (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
      if (!source) return;
      emit('network_error', `Failed to load ${target.tagName.toLowerCase()}`, {
        meta: { method: 'GET', status: 0, request_url: source, resource: target.tagName.toLowerCase() }
      });
    },
    true
  );
}

// --- Unhandled promise rejections ---

export function installRejectionCapture(emit: EmitFn): void {
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      emit('unhandled_rejection', reason.message, { stack: reason.stack, error_type: reason.name });
    } else {
      emit('unhandled_rejection', safeString(reason), { error_type: 'UnhandledRejection' });
    }
  });
}

// --- console.error ---

let inConsoleHook = false;

export function installConsoleCapture(emit: EmitFn): void {
  const original = console.error;
  console.error = function (...args: unknown[]) {
    original.apply(console, args);
    if (inConsoleHook) return; // an SDK-internal error must never loop
    inConsoleHook = true;
    try {
      const message = args.map((a) => safeString(a)).join(' ').slice(0, 1_000);
      const firstError = args.find((a): a is Error => a instanceof Error);
      const stack = firstError?.stack ?? stripSdkFrames(new Error().stack ?? '');
      emit('console_error', message, { stack });
    } catch {
      // swallow — reporting must not break the page
    } finally {
      inConsoleHook = false;
    }
  };
}

// --- fetch + XHR failures ---

export function installNetworkCapture(emit: EmitFn, ingestEndpoint: string, ignoreUrls: Array<string | RegExp>): void {
  const resolve = (url: string): string => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  };
  const endpointHref = resolve(ingestEndpoint);

  const isIgnored = (url: string): boolean => {
    const href = resolve(url);
    if (href.indexOf(endpointHref) === 0) return true; // never report our own ingest calls
    return ignoreUrls.some((pattern) =>
      typeof pattern === 'string' ? href.indexOf(pattern) !== -1 : pattern.test(href)
    );
  };

  const report = (method: string, url: string, status: number, durationMs: number, detail?: string) => {
    const label = status > 0 ? `HTTP ${status}` : detail || 'network failure';
    emit('network_error', `${method} ${url} failed: ${label}`, {
      meta: { method, status, request_url: url, duration_ms: Math.round(durationMs) }
    });
  };

  // fetch
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (isIgnored(url)) return originalFetch.call(window, input as RequestInfo, init);
      const start = Date.now();
      return originalFetch.call(window, input as RequestInfo, init).then(
        (response) => {
          if (response.status >= 400) report(method, url, response.status, Date.now() - start);
          return response;
        },
        (error: unknown) => {
          report(method, url, 0, Date.now() - start, safeString(error, 120));
          throw error;
        }
      );
    };
  }

  // XMLHttpRequest
  const XhrProto = XMLHttpRequest.prototype;
  const originalOpen = XhrProto.open;
  const originalSend = XhrProto.send;
  interface TrackedXhr extends XMLHttpRequest {
    __bd?: { method: string; url: string; start: number; aborted: boolean };
  }

  XhrProto.open = function (this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__bd = { method: String(method).toUpperCase(), url: String(url), start: 0, aborted: false };
    return (originalOpen as Function).call(this, method, url, ...rest);
  } as typeof XhrProto.open;

  XhrProto.send = function (this: TrackedXhr, ...args: unknown[]) {
    const tracked = this.__bd;
    if (tracked && !isIgnored(tracked.url)) {
      tracked.start = Date.now();
      this.addEventListener('abort', () => {
        tracked.aborted = true;
      });
      this.addEventListener('loadend', () => {
        if (tracked.aborted) return;
        if (this.status === 0 || this.status >= 400) {
          report(tracked.method, tracked.url, this.status, Date.now() - tracked.start);
        }
      });
    }
    return (originalSend as Function).apply(this, args);
  } as typeof XhrProto.send;
}
