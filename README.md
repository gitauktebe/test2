# feedback-photo-bot

Telegram-бот для сбора фото и пересылки в целевую группу через Supabase Edge Functions.

## Структура

- `supabase/functions/tg-webhook/index.ts` — webhook-обработчик Telegram.
- `supabase/functions/tg-worker/index.ts` — worker для отправки накопленных фото.
- `supabase/migrations/0001_bot_state.sql` — старая таблица состояния (история).
- `supabase/migrations/0002_tg_updates.sql` — таблица дедупликации обновлений.
- `supabase/migrations/0003_bot_submissions_v2.sql` — текущая таблица заявок.
- `supabase/migrations/0005_bot_submissions_schema.sql` — актуализация схемы под tg-webhook.

## Переменные окружения

В Supabase Edge Functions должны быть заданы:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TG_TARGET_CHAT_ID`
- `TG_WORKER_BATCH_LIMIT` (необязательно, количество заявок за один запуск worker)

## Деплой функций

```bash
supabase functions deploy tg-webhook --no-verify-jwt
supabase functions deploy tg-worker --no-verify-jwt
supabase secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TG_TARGET_CHAT_ID=... \
  TG_WORKER_BATCH_LIMIT=5
```

Применить миграцию:

```bash
supabase db push
```

После деплоя выполнить миграции (при необходимости через SQL Editor в Supabase).

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

## Запуск worker вручную

```bash
curl -X POST "https://<PROJECT_REF>.functions.supabase.co/tg-worker"
```

## Как проверить работу

1. Откройте диалог с ботом, выполните `/start`, нажмите "Отправить фото" и дойдите до шага отправки фото.
2. Отправьте 5–30 фото (можно альбомом).
3. Нажмите "Готово ✅". Бот ответит «Отправляю…».
4. Запустите `tg-worker` (или дождитесь запланированного запуска) и убедитесь, что фото появились в целевом чате.
5. Проверьте, что пользователь получил финальное сообщение «Фото доставлены, спасибо».

## Как посмотреть логи

```bash
supabase functions logs tg-webhook
supabase functions logs tg-worker
```

## Команды

- `/start` — начать диалог.
- `/cancel` — сбросить текущий черновик.
