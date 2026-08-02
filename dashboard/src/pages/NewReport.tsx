import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Issue, type Project } from '../api';
import { Dropzone } from '../components/Dropzone';

export function NewReport() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('bug');
  const [pageUrl, setPageUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<{ projects: Project[] }>('/api/projects').then((r) => {
      setProjects(r.projects);
      if (r.projects[0]) setProjectId((current) => current || r.projects[0]!.id);
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const form = new FormData();
      form.set('project_id', projectId);
      form.set('title', title.trim());
      form.set('description', description);
      form.set('priority', priority);
      form.set('category', category);
      if (pageUrl.trim()) form.set('page_url', pageUrl.trim());
      files.forEach((file) => form.append('images', file));
      const r = await api.upload<{ issue: Issue }>('/api/reports', form);
      navigate(`/issues/${r.issue.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Report a bug or feature request</h1>
      </div>
      <form className="card" style={{ maxWidth: 640 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="rp-project">Project</label>
          <select id="rp-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} required style={{ width: '100%' }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rp-title">Title</label>
          <input id="rp-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} style={{ width: '100%' }} placeholder="Short summary of the problem or request" />
        </div>
        <div className="field">
          <label htmlFor="rp-desc">Description</label>
          <textarea id="rp-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} style={{ width: '100%' }} placeholder="What happened? What did you expect? Steps to reproduce…" />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="rp-cat">Type</label>
            <select id="rp-cat" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
              <option value="bug">Bug</option>
              <option value="feature">Feature request</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="rp-pri">Priority</label>
            <select id="rp-pri" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: '100%' }}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="rp-url">Page URL (optional)</label>
          <input id="rp-url" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} style={{ width: '100%' }} placeholder="https://yoursite.com/checkout" />
        </div>
        <div className="field">
          <label>Screenshots</label>
          <Dropzone files={files} onChange={setFiles} />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={busy || !title.trim() || !projectId}>
          {busy ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
    </>
  );
}
