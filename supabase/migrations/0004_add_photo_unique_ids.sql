alter table public.bot_submissions
  add column if not exists photo_unique_ids jsonb not null default '[]'::jsonb;
