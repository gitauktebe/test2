create extension if not exists "pgcrypto";

create table if not exists public.bot_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id bigint,
  chat_id bigint,
  created_at timestamptz not null default now(),
  event_date text,
  event_type text,
  custom_event_type text,
  sport text,
  gender text,
  stage text,
  phase text,
  photo_file_ids jsonb not null default '[]'::jsonb,
  photo_unique_ids jsonb not null default '[]'::jsonb,
  status text not null default 'collecting',
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text
);

alter table public.bot_submissions
  add column if not exists id uuid,
  add column if not exists user_id bigint,
  add column if not exists chat_id bigint,
  add column if not exists created_at timestamptz,
  add column if not exists event_date text,
  add column if not exists event_type text,
  add column if not exists custom_event_type text,
  add column if not exists sport text,
  add column if not exists gender text,
  add column if not exists stage text,
  add column if not exists phase text,
  add column if not exists photo_file_ids jsonb,
  add column if not exists photo_unique_ids jsonb,
  add column if not exists status text,
  add column if not exists attempts int,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text;

update public.bot_submissions
  set id = gen_random_uuid()
  where id is null;

alter table public.bot_submissions
  drop constraint if exists bot_submissions_pkey;

alter table public.bot_submissions
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column photo_file_ids set default '[]'::jsonb,
  alter column photo_file_ids set not null,
  alter column photo_unique_ids set default '[]'::jsonb,
  alter column photo_unique_ids set not null,
  alter column status set default 'collecting',
  alter column status set not null,
  alter column attempts set default 0,
  alter column attempts set not null;

alter table public.bot_submissions
  add primary key (id);

create index if not exists bot_submissions_chat_id_idx
  on public.bot_submissions (chat_id);

create index if not exists bot_submissions_created_at_desc_idx
  on public.bot_submissions (created_at desc);

create index if not exists bot_submissions_user_status_created_at_idx
  on public.bot_submissions (user_id, status, created_at desc);

create index if not exists bot_submissions_status_retry_idx
  on public.bot_submissions (status, next_retry_at);

create table if not exists public.tg_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists tg_updates_created_at_desc_idx
  on public.tg_updates (created_at desc);
