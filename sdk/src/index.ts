import { installConsoleCapture, installErrorCapture, installNetworkCapture, installRejectionCapture, type EmitFn } from './capture.js';
import { installPerfCapture } from './perf.js';
import { Transport } from './transport.js';
import type { InitOptions, SdkEvent } from './types.js';

let transport: Transport | null = null;
let sessionId = '';
let globalMeta: Record<string, unknown> = {};
let initialized = false;

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem('bd_sid');
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('bd_sid', sid);
    }
    return sid;
  } catch {
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

const emit: EmitFn = (type, message, extras = {}) => {
  if (!transport) return;
  const event: SdkEvent = {
    type,
    message: message.slice(0, 4_000),
    stack: extras.stack,
    error_type: extras.error_type,
    url: location.href,
    timestamp: Date.now(),
    session_id: sessionId,
    meta: { ...globalMeta, ...extras.meta }
  };
  transport.enqueue(event);
};

export function init(options: InitOptions): void {
  if (initialized) return;
  if (!options || !options.endpoint || !options.key) {
    // eslint-disable-next-line no-console
    console.warn('[BugDetekter] init requires { endpoint, key }');
    return;
  }
  initialized = true;

  const sampleRate = options.sampleRate ?? 1;
  if (Math.random() >= sampleRate) return; // session not sampled; API stays as no-ops

  sessionId = getSessionId();
  globalMeta = options.metadata ?? {};
  transport = new Transport(options.endpoint, options.key, options.flushInterval ?? 5_000, options.maxBatch ?? 20);

  const capture = { console: true, network: true, performance: false, ...options.capture };

  installErrorCapture(emit);
  installRejectionCapture(emit);
  if (capture.console) installConsoleCapture(emit);
  if (capture.network) installNetworkCapture(emit, options.endpoint, options.ignoreUrls ?? []);
  if (capture.performance) installPerfCapture(emit, options.slowLoadThreshold ?? 3_000);
}

/** Manually report a caught exception. */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (error instanceof Error) {
    emit('exception', error.message, { stack: error.stack, error_type: error.name, meta: extra });
  } else {
    emit('exception', String(error), { error_type: 'Error', meta: extra });
  }
}

/** Manually report a message (grouped like a console error). */
export function captureMessage(message: string, extra?: Record<string, unknown>): void {
  emit('console_error', message, { meta: extra });
}

/** Force-send anything queued. */
export function flush(): void {
  transport?.flush();
}
