# feedback-photo-bot

Telegram-бот для сбора фото и пересылки в целевую группу через Supabase Edge Functions.

## Структура

- `supabase/functions/tg-webhook/index.ts` — webhook-обработчик Telegram.
- `supabase/migrations/0001_bot_state.sql` — таблица состояния.
- `supabase/migrations/0002_tg_updates.sql` — таблица дедупликации обновлений.

## Переменные окружения

В Supabase Edge Function должны быть заданы:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TG_TARGET_CHAT_ID`

## Деплой функции

```bash
supabase functions deploy tg-webhook --no-verify-jwt
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

## Проверка webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

После деплоя `tg-webhook` поле `last_error_message` с `401 Unauthorized` должно исчезнуть.

## Команды

- `/start` — начать диалог.
- `/cancel` — сбросить текущий черновик.

## Минимальный тест (альбом 14 фото)

1. Откройте диалог с ботом, выполните `/start`, выберите "Отправить фото" и дойдите до шага отправки фото.
2. В Telegram выделите 14 фотографий и отправьте их одним альбомом (media group).
3. Проверьте целевой чат: бот должен отправить 2 чанка (10 + 4) без ошибок 500 в логах webhook.
