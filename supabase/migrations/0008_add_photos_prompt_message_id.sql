alter table public.bot_submissions
  add column if not exists photos_prompt_message_id bigint null;
