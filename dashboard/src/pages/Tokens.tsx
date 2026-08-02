import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiToken } from '../api';
import { timeAgo } from '../components/ui';

export function Tokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('write');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .get<{ tokens: ApiToken[] }>('/api/tokens')
      .then((r) => setTokens(r.tokens))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setError('Admin access required to manage tokens.');
      });
  };
  useEffect(load, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCreated(null);
    try {
      const r = await api.post<{ value: string }>('/api/tokens', { name: name.trim(), scope });
      setCreated(r.value);
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>API tokens</h1>
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        Tokens authenticate the MCP server (and any other API client) with <code>Authorization: Bearer</code>. Read
        scope can list and inspect issues; write scope can also update status, comment, and file reports.
      </p>

      <form className="card row" style={{ marginBottom: 18 }} onSubmit={create}>
        <input placeholder="Token name (e.g. claude-mcp)" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="read">Read only</option>
          <option value="write">Read + write</option>
        </select>
        <button className="primary" disabled={busy || !name.trim()}>
          Create token
        </button>
      </form>

      {created && (
        <div className="token-value">
          {created}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Copy this now — it is shown only once.
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <table className="data card" style={{ padding: 0 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Scope</th>
            <th>Last used</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td>{token.name}</td>
              <td>
                <span className={`badge ${token.scope === 'write' ? 'priority-high' : 'priority-low'}`}>{token.scope}</span>
              </td>
              <td>{token.last_used_at ? timeAgo(token.last_used_at) : 'never'}</td>
              <td>{timeAgo(token.created_at)}</td>
              <td>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`Revoke token "${token.name}"?`)) {
                      void api.del(`/api/tokens/${token.id}`).then(load);
                    }
                  }}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
          {tokens.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                No tokens yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
