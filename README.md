# feedback-photo-bot

Telegram-бот для сбора фото и пересылки в целевую группу через Supabase Edge Functions.

## Структура

- `supabase/functions/tg-webhook/index.ts` — webhook-обработчик Telegram.
- `supabase/migrations/0001_bot_state.sql` — таблица состояния.

## Переменные окружения

В Supabase Edge Function должны быть заданы:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TG_TARGET_CHAT_ID`

## Деплой функции

```bash
supabase functions deploy tg-webhook
supabase secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TG_TARGET_CHAT_ID=...
```

Применить миграцию:

```bash
supabase db push
```

## Установка webhook

Замените `<PROJECT_REF>` на ref вашего проекта Supabase.

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<PROJECT_REF>.functions.supabase.co/tg-webhook"}'
```

## Команды

- `/start` — начать диалог.
- `/cancel` — сбросить текущий черновик.
