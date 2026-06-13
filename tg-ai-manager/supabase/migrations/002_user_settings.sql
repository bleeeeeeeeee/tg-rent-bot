-- Per-user preferences (locale, UI, timezone). Run in Supabase SQL editor if not using migrations CLI.

create table if not exists public.user_settings (
  telegram_user_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_settings_updated_at_idx on public.user_settings (updated_at desc);

alter table public.user_settings enable row level security;

-- Service role bypasses RLS; no public policies needed for bot backend.
