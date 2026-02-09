create table if not exists public.tg_updates (
  update_id bigint primary key,
  created_at timestamptz default now()
);
