create table if not exists public.tg_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists tg_updates_created_at_desc_idx
  on public.tg_updates (created_at desc);
