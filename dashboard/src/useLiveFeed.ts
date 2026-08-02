import { useEffect, useRef, useState } from 'react';
import type { FeedEvent } from './api';

const STALE_AFTER_MS = 30_000;

/**
 * Subscribes to the SSE feed. Calls `onEvent` for each issue update and
 * reports the connection mode; when the stream goes silent for 30s (hostile
 * proxy, dropped connection) the mode flips to 'polling' so callers can
 * refetch on an interval instead.
 */
export function useLiveFeed(onEvent: (event: FeedEvent) => void): 'live' | 'polling' {
  const [mode, setMode] = useState<'live' | 'polling'>('polling');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/feed');
    let lastActivity = Date.now();

    const markAlive = () => {
      lastActivity = Date.now();
      setMode('live');
    };

    source.onopen = markAlive;
    source.addEventListener('ping', markAlive);
    source.addEventListener('issue_update', (event) => {
      markAlive();
      try {
        handler.current(JSON.parse((event as MessageEvent).data) as FeedEvent);
      } catch {
        // malformed frame — ignore
      }
    });

    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALE_AFTER_MS) setMode('polling');
    }, 5_000);

    return () => {
      clearInterval(watchdog);
      source.close();
    };
  }, []);

  return mode;
}
