CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  ingest_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  source      text NOT NULL CHECK (source IN ('auto', 'manual')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'ignored')),
  title       text NOT NULL,
  error_type  text,
  description text,
  priority    text CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  category    text CHECK (category IN ('bug', 'feature')),
  page_url    text,
  event_count integer NOT NULL DEFAULT 0,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, fingerprint)
);

CREATE INDEX issues_project_status_idx    ON issues (project_id, status);
CREATE INDEX issues_project_last_seen_idx ON issues (project_id, last_seen DESC);
CREATE INDEX issues_project_source_idx    ON issues (project_id, source);

CREATE TABLE events (
  id              bigserial PRIMARY KEY,
  issue_id        uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('exception', 'unhandled_rejection', 'console_error', 'network_error', 'performance')),
  message         text NOT NULL DEFAULT '',
  stack           text,
  url             text,
  session_id      text,
  browser_name    text,
  browser_version text,
  os_name         text,
  device_type     text,
  meta            jsonb NOT NULL DEFAULT '{}',
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_issue_received_idx   ON events (issue_id, received_at DESC);
CREATE INDEX events_project_received_idx ON events (project_id, received_at DESC);

CREATE TABLE comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id     uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id),
  author_label text NOT NULL DEFAULT '',
  kind         text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'status_change', 'regression')),
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_issue_idx ON comments (issue_id, created_at);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attachments_issue_idx ON attachments (issue_id);

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scope        text NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
  last_used_at timestamptz,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
