create extension if not exists "pgcrypto";

alter table public.bot_submissions
  add column if not exists id uuid,
  add column if not exists chat_id bigint,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists event_date text,
  add column if not exists event_type text,
  add column if not exists custom_event_type text,
  add column if not exists sport text,
  add column if not exists gender text,
  add column if not exists stage text,
  add column if not exists phase text,
  add column if not exists status text not null default 'collecting',
  add column if not exists attempts int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text;

update public.bot_submissions
  set id = gen_random_uuid()
  where id is null;

alter table public.bot_submissions
  drop constraint if exists bot_submissions_pkey;

alter table public.bot_submissions
  alter column id set default gen_random_uuid(),
  alter column id set not null;

alter table public.bot_submissions
  add primary key (id);

alter table public.bot_submissions
  drop column if exists state,
  drop column if exists payload,
  drop column if exists updated_at;

create index if not exists bot_submissions_status_retry_idx
  on public.bot_submissions (status, next_retry_at);
