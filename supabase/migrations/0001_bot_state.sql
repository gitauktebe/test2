create table if not exists public.bot_submissions (
  user_id bigint primary key,
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  photo_file_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists bot_submissions_updated_at_idx
  on public.bot_submissions (updated_at);
