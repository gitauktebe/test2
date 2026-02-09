create extension if not exists "pgcrypto";

create table if not exists public.tg_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists tg_updates_created_at_desc_idx
  on public.tg_updates (created_at desc);

create table if not exists public.bot_submissions_v2 (
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

do $$
declare
  has_bot_submissions boolean;
  has_id boolean;
  has_user_id boolean;
  has_chat_id boolean;
  has_created_at boolean;
  has_updated_at boolean;
  has_event_date boolean;
  has_event_type boolean;
  has_custom_event_type boolean;
  has_sport boolean;
  has_gender boolean;
  has_stage boolean;
  has_phase boolean;
  has_photo_file_ids boolean;
  has_photo_unique_ids boolean;
  has_status boolean;
  has_attempts boolean;
  has_next_retry_at boolean;
  has_last_error boolean;
  id_expr text;
  user_id_expr text;
  chat_id_expr text;
  created_at_expr text;
  event_date_expr text;
  event_type_expr text;
  custom_event_type_expr text;
  sport_expr text;
  gender_expr text;
  stage_expr text;
  phase_expr text;
  photo_file_ids_expr text;
  photo_unique_ids_expr text;
  status_expr text;
  attempts_expr text;
  next_retry_at_expr text;
  last_error_expr text;
  insert_sql text;
begin
  select to_regclass('public.bot_submissions') is not null into has_bot_submissions;

  if not has_bot_submissions then
    alter table public.bot_submissions_v2 rename to bot_submissions;
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'id'
  ) into has_id;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'user_id'
  ) into has_user_id;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'chat_id'
  ) into has_chat_id;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'created_at'
  ) into has_created_at;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'updated_at'
  ) into has_updated_at;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'event_date'
  ) into has_event_date;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'event_type'
  ) into has_event_type;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'custom_event_type'
  ) into has_custom_event_type;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'sport'
  ) into has_sport;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'gender'
  ) into has_gender;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'stage'
  ) into has_stage;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'phase'
  ) into has_phase;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'photo_file_ids'
  ) into has_photo_file_ids;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'photo_unique_ids'
  ) into has_photo_unique_ids;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'status'
  ) into has_status;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'attempts'
  ) into has_attempts;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'next_retry_at'
  ) into has_next_retry_at;
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_submissions' and column_name = 'last_error'
  ) into has_last_error;

  id_expr := case when has_id then 'coalesce(id, gen_random_uuid())' else 'gen_random_uuid()' end;
  user_id_expr := case when has_user_id then 'user_id' else 'null::bigint' end;
  chat_id_expr := case when has_chat_id then 'chat_id' else 'null::bigint' end;
  created_at_expr := case
    when has_created_at then 'created_at'
    when has_updated_at then 'updated_at'
    else 'now()'
  end;
  event_date_expr := case when has_event_date then 'event_date' else 'null::text' end;
  event_type_expr := case when has_event_type then 'event_type' else 'null::text' end;
  custom_event_type_expr := case when has_custom_event_type then 'custom_event_type' else 'null::text' end;
  sport_expr := case when has_sport then 'sport' else 'null::text' end;
  gender_expr := case when has_gender then 'gender' else 'null::text' end;
  stage_expr := case when has_stage then 'stage' else 'null::text' end;
  phase_expr := case when has_phase then 'phase' else 'null::text' end;
  photo_file_ids_expr := case
    when has_photo_file_ids then 'coalesce(photo_file_ids, ''[]''::jsonb)'
    else '''[]''::jsonb'
  end;
  photo_unique_ids_expr := case
    when has_photo_unique_ids then 'coalesce(photo_unique_ids, coalesce(photo_file_ids, ''[]''::jsonb))'
    when has_photo_file_ids then 'coalesce(photo_file_ids, ''[]''::jsonb)'
    else '''[]''::jsonb'
  end;
  status_expr := case when has_status then 'coalesce(status, ''collecting'')' else '''collecting''' end;
  attempts_expr := case when has_attempts then 'coalesce(attempts, 0)' else '0' end;
  next_retry_at_expr := case when has_next_retry_at then 'next_retry_at' else 'null::timestamptz' end;
  last_error_expr := case when has_last_error then 'last_error' else 'null::text' end;

  insert_sql := format(
    'insert into public.bot_submissions_v2
      (id, user_id, chat_id, created_at, event_date, event_type, custom_event_type, sport, gender, stage, phase,
       photo_file_ids, photo_unique_ids, status, attempts, next_retry_at, last_error)
     select %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
     from public.bot_submissions
     on conflict (id) do nothing',
    id_expr, user_id_expr, chat_id_expr, created_at_expr, event_date_expr, event_type_expr, custom_event_type_expr,
    sport_expr, gender_expr, stage_expr, phase_expr, photo_file_ids_expr, photo_unique_ids_expr, status_expr,
    attempts_expr, next_retry_at_expr, last_error_expr
  );

  execute insert_sql;

  drop table public.bot_submissions;
  alter table public.bot_submissions_v2 rename to bot_submissions;
end $$;

create index if not exists bot_submissions_chat_id_idx
  on public.bot_submissions (chat_id);

create index if not exists bot_submissions_created_at_desc_idx
  on public.bot_submissions (created_at desc);

create index if not exists bot_submissions_user_status_created_at_idx
  on public.bot_submissions (user_id, status, created_at desc);

create index if not exists bot_submissions_status_retry_idx
  on public.bot_submissions (status, next_retry_at);

create or replace function public.append_submission_photo(
  p_submission_id uuid,
  p_file_id text,
  p_unique_id text
)
returns table(photo_count int, added boolean)
language plpgsql
as $$
declare
  old_photo_file_ids jsonb;
begin
  select coalesce(photo_file_ids, '[]'::jsonb)
    into old_photo_file_ids
    from public.bot_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;

  update public.bot_submissions
     set photo_file_ids = case
       when old_photo_file_ids ? p_file_id then old_photo_file_ids
       else old_photo_file_ids || jsonb_build_array(p_file_id)
     end,
         photo_unique_ids = case
       when coalesce(photo_unique_ids, '[]'::jsonb) ? p_unique_id
         then coalesce(photo_unique_ids, '[]'::jsonb)
       else coalesce(photo_unique_ids, '[]'::jsonb) || jsonb_build_array(p_unique_id)
     end
   where id = p_submission_id
  returning jsonb_array_length(photo_file_ids),
            not (old_photo_file_ids ? p_file_id)
    into photo_count, added;

  return;
end;
$$;
