export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form })
};

// --- shared response types ---

export interface Project {
  id: string;
  name: string;
  slug: string;
  ingest_key: string;
  created_at: string;
  open_issues?: number;
  total_events?: number;
  snippet?: string;
}

export interface Issue {
  id: string;
  project_id: string;
  project_name?: string;
  source: 'auto' | 'manual';
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  title: string;
  error_type: string | null;
  description?: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical' | null;
  category: 'bug' | 'feature' | null;
  page_url?: string | null;
  event_count: number;
  first_seen: string;
  last_seen: string;
  resolved_at?: string | null;
  spark?: number[] | null;
}

export interface IssueDetailResponse {
  issue: Issue;
  aggregates: {
    browsers: Array<{ name: string; count: number }>;
    urls: Array<{ url: string; count: number }>;
    session_count: number;
  };
  latest_event: EventRow | null;
  attachments: Attachment[];
}

export interface EventRow {
  id?: number;
  type: string;
  message: string;
  stack: string | null;
  url: string | null;
  session_id: string | null;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  device_type: string | null;
  meta: Record<string, unknown>;
  received_at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at?: string;
  url: string;
}

export interface Comment {
  id: string;
  author_label: string;
  author_email?: string | null;
  kind: 'comment' | 'status_change' | 'regression';
  body: string;
  created_at: string;
}

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

export interface StatsOverview {
  range: string;
  bucket: 'hour' | 'day';
  totals: { events: number; open_issues: number; open_manual: number; projects: number };
  buckets: Array<{ t: number; count: number }>;
  top_issues: Array<Issue & { recent_events: number }>;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: 'read' | 'write';
  last_used_at: string | null;
  created_at: string;
}
