import { useEffect, useState, type FormEvent } from 'react';
import { api, type Project } from '../api';
import { CopyButton } from '../components/ui';

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    void api.get<{ projects: Project[] }>('/api/projects').then((r) => setProjects(r.projects));
  };
  useEffect(load, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ project: Project }>('/api/projects', { name: name.trim() });
      setName('');
      load();
      setExpanded(r.project.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <form className="row" onSubmit={create}>
          <input placeholder="New site name…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={busy || !name.trim()}>
            Add project
          </button>
        </form>
      </div>

      <div className="issue-list">
        {projects.map((project) => (
          <div className="card" key={project.id}>
            <div className="row">
              <div>
                <strong>{project.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {project.slug} · {project.open_issues ?? 0} open issues · {project.total_events ?? 0} events
                </div>
              </div>
              <div className="spacer" />
              <span className="mono muted">{project.ingest_key}</span>
              <button onClick={() => setExpanded(expanded === project.id ? null : project.id)}>
                {expanded === project.id ? 'Hide snippet' : 'Embed snippet'}
              </button>
            </div>
            {expanded === project.id && project.snippet && (
              <div className="snippet-box" style={{ marginTop: 12 }}>
                {project.snippet}
                <CopyButton text={project.snippet} />
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && <div className="empty card">No projects yet — add your first site above.</div>}
      </div>
    </>
  );
}
