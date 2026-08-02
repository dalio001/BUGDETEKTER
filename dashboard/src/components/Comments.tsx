import { useEffect, useState, type FormEvent } from 'react';
import { api, type Comment } from '../api';
import { timeAgo } from './ui';

export function Comments({ issueId }: { issueId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api.get<{ comments: Comment[] }>(`/api/issues/${issueId}/comments`).then((r) => setComments(r.comments));
  };
  useEffect(load, [issueId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/issues/${issueId}/comments`, { body: body.trim() });
      setBody('');
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 className="section-title">Activity</h2>
      {comments.length === 0 && <div className="muted">No activity yet.</div>}
      {comments.map((comment) =>
        comment.kind === 'comment' ? (
          <div className="comment" key={comment.id}>
            <div className="comment-head">
              <strong>{comment.author_label}</strong> · {timeAgo(comment.created_at)}
            </div>
            <div>{comment.body}</div>
          </div>
        ) : (
          <div className="comment system" key={comment.id}>
            {comment.kind === 'regression' ? '⚠ ' : ''}
            {comment.body}
            {comment.author_label && comment.author_label !== 'system' ? ` — ${comment.author_label}` : ''} ·{' '}
            {timeAgo(comment.created_at)}
          </div>
        )
      )}
      <form className="comment-form" onSubmit={submit}>
        <textarea placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="primary" disabled={busy || !body.trim()}>
          Comment
        </button>
      </form>
    </div>
  );
}
