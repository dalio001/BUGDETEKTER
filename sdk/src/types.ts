export type EventType = 'exception' | 'unhandled_rejection' | 'console_error' | 'network_error' | 'performance';

export interface SdkEvent {
  type: EventType;
  message: string;
  stack?: string;
  error_type?: string;
  url: string;
  timestamp: number;
  session_id: string;
  meta?: Record<string, unknown>;
}

export interface CaptureOptions {
  console: boolean;
  network: boolean;
  performance: boolean;
}

export interface InitOptions {
  /** Full URL of the ingest endpoint, e.g. https://bugs.example.com/api/ingest */
  endpoint: string;
  /** Project ingest key (pk_...) */
  key: string;
  capture?: Partial<CaptureOptions>;
  /** Emit a performance event when loadEventEnd exceeds this (ms). Default 3000. */
  slowLoadThreshold?: number;
  /** Queue flush interval in ms. Default 5000. */
  flushInterval?: number;
  /** Flush as soon as this many events are queued. Default 20. */
  maxBatch?: number;
  /** Request URLs (substring or RegExp) to exclude from network capture. */
  ignoreUrls?: Array<string | RegExp>;
  /** Fraction of sessions to monitor (0..1). Default 1. */
  sampleRate?: number;
  /** Extra key/values merged into every event's meta. */
  metadata?: Record<string, unknown>;
}
