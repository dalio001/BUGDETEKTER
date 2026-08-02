import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type EventRow, type IssueDetailResponse } from '../api';
import { useLiveFeed } from '../useLiveFeed';
import { Comments } from '../components/Comments';
import { PriorityBadge, SourceBadge, StackTrace, StatusBadge, timeAgo, TrendChart, type Bucket } from '../components/ui';

const EVENTS_PAGE = 20;

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<IssueDetailResponse | null>(null);
  const [stats, setStats] = useState<{ bucket: 'hour' | 'day'; buckets: Bucket[] } | null>(null);
  const [range, setRange] = useState('7d');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [activityKey, setActivityKey] = useState(0);
  const [error, setError] = useState('');
  const statsSeq = useRef(0);

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<IssueDetailResponse>(`/api/issues/${id}`)
      .then(setData)
      .catch(() => setError('Issue not found'));
    void api.get<{ events: EventRow[]; total: number }>(`/api/issues/${id}/events?limit=${EVENTS_PAGE}`).then((r) => {
      setEvents(r.events);
      setEventsTotal(r.total);
    });
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!id) return;
    // Guard against a slow earlier range overwriting the range now selected.
    const seq = ++statsSeq.current;
    void api.get<{ bucket: 'hour' | 'day'; buckets: Bucket[] }>(`/api/issues/${id}/stats?range=${range}`).then((r) => {
      if (seq === statsSeq.current) setStats(r);
    });
  }, [id, range]);

  useLiveFeed(
    useCallback(
      (event) => {
        if (event.issue_id === id) load();
      },
      [id, load]
    )
  );

  if (error) {
    return (
      <div className="empty card">
        {error} — <Link to="/issues">back to issues</Link>
      </div>
    );
  }
  if (!data) return <div className="empty">Loading…</div>;
  const { issue, aggregates, latest_event, attachments } = data;

  const updateIssue = async (patch: Record<string, string>) => {
    await api.patch(`/api/issues/${id}`, patch);
    load();
    // A status change writes a system comment — pull the activity list along with it.
    setActivityKey((key) => key + 1);
  };

  const loadMoreEvents = async () => {
    const r = await api.get<{ events: EventRow[]; total: number }>(
      `/api/issues/${id}/events?limit=${EVENTS_PAGE}&offset=${events.length}`
    );
    setEvents((prev) => [...prev, ...r.events]);
    setEventsTotal(r.total);
  };

  const stack = latest_event?.stack ?? null;

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <SourceBadge source={issue.source} />
            <PriorityBadge priority={issue.priority} />
            <StatusBadge status={issue.status} />
            {issue.category && <span className="badge source-manual">{issue.category}</span>}
          </div>
          <h1 style={{ wordBreak: 'break-word' }}>{issue.title}</h1>
          <div className="muted">
            {issue.project_name} · first seen {timeAgo(issue.first_seen)} · last seen {timeAgo(issue.last_seen)} ·{' '}
            {issue.event_count} events · {aggregates.session_count} sessions
          </div>
        </div>
        <div className="row">
          <select value={issue.status} onChange={(e) => void updateIssue({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
          <select value={issue.priority ?? ''} onChange={(e) => void updateIssue({ priority: e.target.value })}>
            <option value="" disabled>
              Priority…
            </option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                Occurrences
              </h2>
              <div className="spacer" />
              <div className="tabs">
                {['24h', '7d', '30d'].map((r) => (
                  <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {stats && <TrendChart buckets={stats.buckets} bucket={stats.bucket} range={range} />}
          </div>

          {issue.description && (
            <div className="card">
              <h2 className="section-title">Description</h2>
              <div style={{ whiteSpace: 'pre-wrap' }}>{issue.description}</div>
            </div>
          )}

          {stack && (
            <div className="card">
              <h2 className="section-title">Stack trace (latest event)</h2>
              <StackTrace stack={stack} />
            </div>
          )}

          {attachments.length > 0 && (
            <div className="card">
              <h2 className="section-title">Screenshots</h2>
              <div className="attachment-grid">
                {attachments.map((att) => (
                  <a key={att.id} href={att.url} target="_blank" rel="noreferrer">
                    <img src={att.url} alt={att.filename} title={att.filename} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {issue.source === 'auto' && (
            <div className="card">
              <h2 className="section-title">Recent events</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Browser</th>
                    <th>URL</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, i) => (
                    <tr key={event.id ?? i}>
                      <td title={event.received_at}>{timeAgo(event.received_at)}</td>
                      <td className="mono">{event.type}</td>
                      <td>
                        {event.browser_name ?? '—'} {event.browser_version ?? ''}
                        <div className="muted">{event.os_name ?? ''}</div>
                      </td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={event.url ?? ''}>
                        {event.url ?? '—'}
                      </td>
                      <td>
                        {event.stack && (
                          <button className="stack-toggle" onClick={() => setExpandedEvent(expandedEvent === i ? null : i)}>
                            {expandedEvent === i ? 'hide stack' : 'stack'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expandedEvent !== null && events[expandedEvent]?.stack && (
                <div style={{ marginTop: 10 }}>
                  <StackTrace stack={events[expandedEvent]!.stack!} />
                </div>
              )}
              {events.length < eventsTotal && (
                <div className="pagination">
                  <button onClick={() => void loadMoreEvents()}>Load more ({events.length}/{eventsTotal})</button>
                </div>
              )}
            </div>
          )}

          <Comments issueId={issue.id} refreshKey={activityKey} />
        </div>

        <div className="detail-side">
          <div className="card">
            <h2 className="section-title">Details</h2>
            <dl className="meta-list">
              <dt>Status</dt>
              <dd>
                <StatusBadge status={issue.status} />
              </dd>
              <dt>Source</dt>
              <dd>{issue.source === 'auto' ? 'Auto-detected' : 'Manually reported'}</dd>
              {issue.error_type && (
                <>
                  <dt>Error type</dt>
                  <dd className="mono">{issue.error_type}</dd>
                </>
              )}
              {issue.page_url && (
                <>
                  <dt>Page</dt>
                  <dd title={issue.page_url}>{issue.page_url}</dd>
                </>
              )}
              <dt>First seen</dt>
              <dd title={issue.first_seen}>{timeAgo(issue.first_seen)}</dd>
              <dt>Last seen</dt>
              <dd title={issue.last_seen}>{timeAgo(issue.last_seen)}</dd>
            </dl>
          </div>

          {aggregates.browsers.length > 0 && (
            <div className="card">
              <h2 className="section-title">Browsers</h2>
              {aggregates.browsers.map((browser) => {
                const max = aggregates.browsers[0]?.count ?? 1;
                return (
                  <div className="bar-row" key={browser.name}>
                    <span className="bar-label" title={browser.name}>
                      {browser.name}
                    </span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(browser.count / max) * 100}%` }} />
                    </div>
                    <span className="bar-count">{browser.count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {aggregates.urls.length > 0 && (
            <div className="card">
              <h2 className="section-title">Affected URLs</h2>
              {aggregates.urls.map((row) => {
                const max = aggregates.urls[0]?.count ?? 1;
                return (
                  <div className="bar-row" key={row.url}>
                    <span className="bar-label" title={row.url}>
                      {row.url.replace(/^https?:\/\//, '')}
                    </span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
                    </div>
                    <span className="bar-count">{row.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
