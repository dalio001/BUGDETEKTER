import { EventEmitter } from 'node:events';

export interface FeedEvent {
  issue_id: string;
  project_id: string;
  title: string;
  status: string;
  source: 'auto' | 'manual';
  event_count: number;
  last_seen: string;
  kind: 'event' | 'created' | 'regression' | 'status_change';
}

/** In-process pub/sub bus connecting ingest/report writes to SSE subscribers. */
export class FeedBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: FeedEvent): void {
    this.emitter.emit('issue_update', event);
  }

  subscribe(listener: (event: FeedEvent) => void): () => void {
    this.emitter.on('issue_update', listener);
    return () => this.emitter.off('issue_update', listener);
  }
}
