import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Submission = {
  id: string;
  user_id: number;
  chat_id: number;
  created_at: string;
  event_date: string | null;
  event_type: string | null;
  custom_event_type: string | null;
  sport: string | null;
  gender: string | null;
  stage: string | null;
  phase: string | null;
  photo_file_ids: string[];
  status: string;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
};

const TELEGRAM_API = "https://api.telegram.org";
const PHOTO_CHUNK_SIZE = 10;
const DEFAULT_BATCH_LIMIT = 5;

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL");
const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const botToken = getEnv("TELEGRAM_BOT_TOKEN");
const targetChatId = getEnv("TG_TARGET_CHAT_ID");

class TelegramRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function callTelegram(method: string, body: Record<string, unknown>) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = await response.text();
    }

    const retryAfter =
      typeof payload === "object" && payload
        ? (payload as { parameters?: { retry_after?: number } }).parameters?.retry_after
        : undefined;

    if (response.status === 429 && retryAfter) {
      throw new TelegramRateLimitError(`Telegram rate limit: retry after ${retryAfter}`, retryAfter);
    }

    throw new Error(`Telegram API error (${method}): ${JSON.stringify(payload)}`);
  }

  return response.json();
}

async function sendMessage(chatId: number | string, text: string) {
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendMediaGroup(chatId: number | string, fileIds: string[]) {
  if (!fileIds.length) return;
  for (let i = 0; i < fileIds.length; i += PHOTO_CHUNK_SIZE) {
    const chunk = fileIds.slice(i, i + PHOTO_CHUNK_SIZE);
    const media = chunk.map((fileId) => ({ type: "photo", media: fileId }));
    await callTelegram("sendMediaGroup", { chat_id: chatId, media });
  }
}

function formatHeader(submission: Submission) {
  const typeValue = submission.custom_event_type ?? submission.event_type ?? "-";
  const dateValue = submission.event_date ?? "-";
  const sportValue = submission.sport ?? "-";
  const genderValue = submission.gender ?? "-";
  const stageValue = submission.stage ?? "-";
  const phaseValue = submission.phase ?? "-";
  return [`[${dateValue}]`, typeValue, sportValue, genderValue, stageValue, phaseValue].join("\n");
}

async function fetchPendingSubmissions(batchLimit: number) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("bot_submissions")
    .select(
      "id,user_id,chat_id,created_at,event_date,event_type,custom_event_type,sport,gender,stage,phase,photo_file_ids,status,attempts,next_retry_at,last_error",
    )
    .eq("status", "pending_send")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(batchLimit);

  if (error) {
    throw new Error(`Failed to load pending submissions: ${error.message}`);
  }

  return (data ?? []) as Submission[];
}

async function markSending(submission: Submission) {
  const { data, error } = await supabase
    .from("bot_submissions")
    .update({
      status: "sending",
      last_error: null,
    })
    .eq("id", submission.id)
    .eq("status", "pending_send")
    .select(
      "id,user_id,chat_id,created_at,event_date,event_type,custom_event_type,sport,gender,stage,phase,photo_file_ids,status,attempts,next_retry_at,last_error",
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark sending: ${error.message}`);
  }

  return data as Submission | null;
}

async function markPendingWithRetry(submission: Submission, retryAfterSeconds: number, errorText: string) {
  const retryAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  const { error } = await supabase
    .from("bot_submissions")
    .update({
      status: "pending_send",
      next_retry_at: retryAt,
      last_error: errorText,
      attempts: submission.attempts + 1,
    })
    .eq("id", submission.id);

  if (error) {
    throw new Error(`Failed to mark retry: ${error.message}`);
  }
}

async function markFailed(submission: Submission, errorText: string) {
  const { error } = await supabase
    .from("bot_submissions")
    .update({
      status: "failed",
      last_error: errorText,
      attempts: submission.attempts + 1,
    })
    .eq("id", submission.id);

  if (error) {
    throw new Error(`Failed to mark failed: ${error.message}`);
  }
}

async function markSent(submission: Submission) {
  const { error } = await supabase
    .from("bot_submissions")
    .update({
      status: "sent",
      next_retry_at: null,
      last_error: null,
      attempts: submission.attempts + 1,
    })
    .eq("id", submission.id);

  if (error) {
    throw new Error(`Failed to mark sent: ${error.message}`);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = performance.now();
  const batchLimit = Number(Deno.env.get("TG_WORKER_BATCH_LIMIT") ?? DEFAULT_BATCH_LIMIT);
  let processed = 0;
  let errors: string[] = [];

  try {
    const pending = await fetchPendingSubmissions(batchLimit);

    for (const submission of pending) {
      const locked = await markSending(submission);
      if (!locked) {
        continue;
      }

      try {
        const header = formatHeader(locked);
        await sendMessage(targetChatId, header);
        await sendMediaGroup(targetChatId, locked.photo_file_ids ?? []);
        await markSent(locked);
        await sendMessage(locked.chat_id, "Фото доставлены, спасибо");
        processed += 1;
      } catch (error) {
        if (error instanceof TelegramRateLimitError) {
          await markPendingWithRetry(locked, error.retryAfterSeconds, error.message);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          await markFailed(locked, message);
          errors.push(message);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
  }

  const durationMs = Math.round(performance.now() - startTime);
  const responseBody = {
    processed,
    errors,
    duration_ms: durationMs,
  };

  return new Response(JSON.stringify(responseBody), {
    status: errors.length ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
