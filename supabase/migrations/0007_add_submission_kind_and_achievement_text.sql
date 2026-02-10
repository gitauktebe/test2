alter table public.bot_submissions
  add column if not exists kind text not null default 'competition';

alter table public.bot_submissions
  add column if not exists achievement_text text;

create index if not exists bot_submissions_kind_status_created_at_idx
  on public.bot_submissions (kind, status, created_at desc);
