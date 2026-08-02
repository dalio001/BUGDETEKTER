import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Issue, type Project } from '../api';
import { useLiveFeed } from '../useLiveFeed';
import { IssueRow, LiveDot } from '../components/ui';

const PAGE_SIZE = 25;
const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'ignored', label: 'Ignored' }
];

export function Issues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recency');
  const [offset, setOffset] = useState(0);
  const [flash, setFlash] = useState(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void api.get<{ projects: Project[] }>('/api/projects').then((r) => setProjects(r.projects));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (search) params.set('search', search);
    params.set('sort', sort);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    void api.get<{ issues: Issue[]; total: number }>(`/api/issues?${params}`).then((r) => {
      setIssues(r.issues);
      setTotal(r.total);
    });
  }, [projectId, status, source, search, sort, offset]);

  useEffect(load, [load]);

  // Live updates: debounce a refetch so bursts of events collapse into one request.
  const mode = useLiveFeed(
    useCallback(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(load, 400);
    }, [load])
  );

  // Polling fallback when the SSE stream is silent/stalled.
  useEffect(() => {
    if (mode !== 'polling') return;
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [mode, load]);

  const setFilter = (apply: () => void) => {
    setOffset(0);
    apply();
  };

  return (
    <>
      <div className="page-head">
        <h1>Issues</h1>
        <LiveDot mode={mode} flash={flash} />
      </div>

      <div className="filter-bar">
        <select value={projectId} onChange={(e) => setFilter(() => setProjectId(e.target.value))}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="tabs">
          {STATUS_TABS.map((tab) => (
            <button key={tab.key} className={status === tab.key ? 'active' : ''} onClick={() => setFilter(() => setStatus(tab.key))}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="tabs">
          {[
            { key: '', label: 'All sources' },
            { key: 'auto', label: 'Auto' },
            { key: 'manual', label: 'Manual' }
          ].map((tab) => (
            <button key={tab.key} className={source === tab.key ? 'active' : ''} onClick={() => setFilter(() => setSource(tab.key))}>
              {tab.label}
            </button>
          ))}
        </div>
        <input placeholder="Search…" value={search} onChange={(e) => setFilter(() => setSearch(e.target.value))} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recency">Most recent</option>
          <option value="frequency">Most events</option>
          <option value="first_seen">Newest first seen</option>
        </select>
      </div>

      <div className="issue-list">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 && <div className="empty card">No issues match these filters. 🎉</div>}
      </div>

      {total > PAGE_SIZE && (
        <div className="pagination">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Prev
          </button>
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}
