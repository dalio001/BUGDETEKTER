import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Issue } from '../api';

export function StatusBadge({ status }: { status: string }) {
  const label = status === 'in_progress' ? 'in progress' : status;
  return <span className={`badge status-${status}`}>{label}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  return <span className={`badge source-${source}`}>{source === 'auto' ? 'auto' : 'manual'}</span>;
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return <span className={`badge priority-${priority}`}>{priority}</span>;
}

export function LiveDot({ mode, flash }: { mode: 'live' | 'polling'; flash?: boolean }) {
  return (
    <span className={`live-dot ${mode === 'live' ? 'live' : ''} ${flash ? 'flash' : ''}`}>
      <i />
      {mode === 'live' ? 'live' : 'polling'}
    </span>
  );
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const width = 96;
  const barWidth = width / data.length;
  return (
    <svg width={width} height={26} aria-hidden>
      {data.map((value, i) => {
        const h = value === 0 ? 1 : Math.max(2, (value / max) * 24);
        return (
          <rect
            key={i}
            x={i * barWidth + 0.5}
            y={26 - h}
            width={Math.max(1, barWidth - 1.2)}
            height={h}
            rx={1}
            fill={value === 0 ? 'var(--border)' : 'var(--accent)'}
          />
        );
      })}
    </svg>
  );
}

export function IssueRow({ issue }: { issue: Issue }) {
  return (
    <Link className="issue-row" to={`/issues/${issue.id}`}>
      <div className="issue-main">
        <div className="issue-title">{issue.title}</div>
        <div className="issue-sub">
          {issue.project_name} · last seen {timeAgo(issue.last_seen)}
          {issue.category ? ` · ${issue.category}` : ''}
        </div>
      </div>
      <SourceBadge source={issue.source} />
      <PriorityBadge priority={issue.priority} />
      <StatusBadge status={issue.status} />
      {issue.spark ? <Sparkline data={issue.spark} /> : null}
      <div className="issue-count">
        {issue.event_count}
        <small>events</small>
      </div>
    </Link>
  );
}

export interface Bucket {
  t: number;
  count: number;
}

/** Hand-rolled SVG bar chart: fills gaps in the time series so quiet periods show as empty space. */
export function TrendChart({ buckets, bucket, height = 120 }: { buckets: Bucket[]; bucket: 'hour' | 'day'; height?: number }) {
  const series = useMemo(() => {
    if (buckets.length === 0) return [];
    const step = bucket === 'hour' ? 3600 : 86_400;
    const nowBucket = Math.floor(Date.now() / 1000 / step) * step;
    const span = bucket === 'hour' ? 24 : buckets.length > 8 ? 30 : 7;
    const start = nowBucket - (span - 1) * step;
    const map = new Map(buckets.map((b) => [b.t, b.count]));
    return Array.from({ length: span }, (_, i) => {
      const t = start + i * step;
      return { t, count: map.get(t) ?? 0 };
    });
  }, [buckets, bucket]);

  if (series.length === 0) return <div className="empty">No events in this period</div>;

  const width = 640;
  const max = Math.max(1, ...series.map((b) => b.count));
  const barWidth = width / series.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      {series.map((point, i) => {
        const h = point.count === 0 ? 1 : Math.max(2, (point.count / max) * (height - 20));
        const date = new Date(point.t * 1000);
        const label =
          bucket === 'hour'
            ? `${date.getHours().toString().padStart(2, '0')}:00`
            : `${date.getMonth() + 1}/${date.getDate()}`;
        return (
          <g key={point.t}>
            <rect
              x={i * barWidth + 1}
              y={height - 16 - h}
              width={Math.max(2, barWidth - 2)}
              height={h}
              rx={2}
              fill={point.count === 0 ? 'var(--border)' : 'var(--accent)'}
            >
              <title>{`${label}: ${point.count} events`}</title>
            </rect>
            {(series.length <= 8 || i % Math.ceil(series.length / 8) === 0) && (
              <text x={i * barWidth + barWidth / 2} y={height - 3} textAnchor="middle" fontSize={10} fill="var(--text-dim)">
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Parsed, readable stack trace with a raw-text toggle. */
export function StackTrace({ stack }: { stack: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const frames = useMemo(() => {
    const parsed: Array<{ fn: string; loc: string }> = [];
    for (const rawLine of stack.split('\n')) {
      const line = rawLine.trim();
      let m = line.match(/^at\s+(?:async\s+)?(?:new\s+)?(.+?)\s+\((.+)\)$/);
      if (m) parsed.push({ fn: m[1]!, loc: m[2]! });
      else if ((m = line.match(/^at\s+(?:async\s+)?(.+)$/))) parsed.push({ fn: '(anonymous)', loc: m[1]! });
      else if ((m = line.match(/^(.*?)@(.+)$/))) parsed.push({ fn: m[1] || '(anonymous)', loc: m[2]! });
    }
    return parsed;
  }, [stack]);

  return (
    <div className="stack">
      {showRaw || frames.length === 0 ? (
        <pre className="stack-raw">{stack}</pre>
      ) : (
        frames.map((frame, i) => (
          <div className="stack-frame" key={i}>
            <span className="fn">{frame.fn}</span> <span className="loc">{frame.loc}</span>
          </div>
        ))
      )}
      {frames.length > 0 && (
        <button className="stack-toggle" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'show parsed' : 'show raw'}
        </button>
      )}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  );
}
