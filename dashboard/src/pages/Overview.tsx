import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Project, type StatsOverview } from '../api';
import { useLiveFeed } from '../useLiveFeed';
import { IssueRow, LiveDot, TrendChart } from '../components/ui';

export function Overview() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [range, setRange] = useState('24h');
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void api.get<{ projects: Project[] }>('/api/projects').then((r) => setProjects(r.projects));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set('project_id', projectId);
    void api.get<StatsOverview>(`/api/stats/overview?${params}`).then(setStats);
  }, [projectId, range]);

  useEffect(load, [load]);

  const mode = useLiveFeed(
    useCallback(() => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(load, 800);
    }, [load])
  );

  useEffect(() => {
    if (mode !== 'polling') return;
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [mode, load]);

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <div className="row">
          <LiveDot mode={mode} />
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="tabs">
            {['24h', '7d', '30d'].map((r) => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {stats && (
        <>
          <div className="stat-grid">
            <div className="card stat-card">
              <div className="stat-value">{stats.totals.events}</div>
              <div className="stat-label">Events ({stats.range})</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.totals.open_issues}</div>
              <div className="stat-label">Open issues</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.totals.open_manual}</div>
              <div className="stat-label">Open manual reports</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.totals.projects}</div>
              <div className="stat-label">Projects</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2 className="section-title">Events over time</h2>
            <TrendChart buckets={stats.buckets} bucket={stats.bucket} height={140} />
          </div>

          <h2 className="section-title">Most active issues ({stats.range})</h2>
          <div className="issue-list">
            {stats.top_issues.map((issue) => (
              <IssueRow key={issue.id} issue={{ ...issue, project_name: undefined }} />
            ))}
            {stats.top_issues.length === 0 && <div className="empty card">No events in this period.</div>}
          </div>
        </>
      )}
    </>
  );
}
