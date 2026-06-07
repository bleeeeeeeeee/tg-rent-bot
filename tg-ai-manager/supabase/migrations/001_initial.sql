-- tg-ai-manager cloud schema (Supabase Postgres)
-- Apply in Supabase SQL Editor or via supabase db push

CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY DEFAULT 'default',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_secrets (
  id text PRIMARY KEY DEFAULT 'default',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_posts (
  id bigint PRIMARY KEY,
  payload jsonb NOT NULL,
  schema_version int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_posts_updated_idx ON channel_posts (updated_at DESC);

CREATE TABLE IF NOT EXISTS processed_entries (
  id bigint PRIMARY KEY,
  content_hash text,
  ai_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafts_user_idx ON drafts (user_id);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  publish_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_status_publish_idx ON scheduled_posts (status, publish_at);

CREATE TABLE IF NOT EXISTS access_data (
  id text PRIMARY KEY DEFAULT 'default',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  role text NOT NULL DEFAULT 'guest',
  label text,
  expires_at timestamptz,
  max_uses int NOT NULL DEFAULT 1,
  use_count int NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  role text NOT NULL DEFAULT 'guest',
  invite_id uuid REFERENCES access_invites(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS access_sessions_active_user_idx
  ON access_sessions (telegram_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_meta (
  id text PRIMARY KEY DEFAULT 'default',
  instance_id text,
  last_push timestamptz,
  last_pull timestamptz,
  last_error text,
  record_counts jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backend-only: disable RLS or restrict to service_role (bot uses service key)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_meta ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated — only service_role bypasses RLS

-- Realtime (optional; for live cache invalidation between instances)
ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE channel_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE drafts;
ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE processed_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE sync_meta;
