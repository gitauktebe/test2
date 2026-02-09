import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Submission = {
  user_id: number;
  state: string;
  payload: Record<string, unknown>;
  photo_file_ids: string[];
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  media_group_id?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const TELEGRAM_API = "https://api.telegram.org";

const START_KEYBOARD = {
  keyboard: [[{ text: "Отправить фото" }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const DONE_KEYBOARD = {
  keyboard: [[{ text: "Готово ✅" }]],
  resize_keyboard: true,
};

const TYPE_OPTIONS = ["ШСЛ", "ПСИ", "ПС", "Фестиваль", "Свой вариант"];
const DISCIPLINE_OPTIONS = [
  "Волейбол",
  "Баскетбол",
  "Футбол",
  "Футзал",
  "Шашки",
  "Шахматы",
  "Пропустить",
];
const GENDER_OPTIONS = ["Девочки", "Мальчики"];
const STAGE_OPTIONS = ["Межрайон", "Москва"];
const PHASE_OPTIONS = ["Группы", "Плейофф"];

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

const MEDIA_GROUP_FLUSH_MIN_MS = 1500;
const MEDIA_GROUP_FLUSH_MAX_MS = 2000;
const MEDIA_GROUP_CHUNK_DELAY_MIN_MS = 200;
const MEDIA_GROUP_CHUNK_DELAY_MAX_MS = 400;

type MediaGroupBuffer = {
  chatId: number | string;
  userId: number;
  fileIds: string[];
  timerId?: number;
};

const mediaGroupBuffers = new Map<string, MediaGroupBuffer>();

function randomBetween(minMs: number, maxMs: number) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTelegram(method: string, body: Record<string, unknown>) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error (${method}): ${errorText}`);
  }

  return response.json();
}

async function sendMessage(chatId: number | string, text: string, replyMarkup?: unknown) {
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

async function sendMediaGroup(
  chatId: number | string,
  fileIds: string[],
  logContext?: { updateId?: number; mediaGroupId?: string },
) {
  const chunks: string[][] = [];
  for (let i = 0; i < fileIds.length; i += 10) {
    chunks.push(fileIds.slice(i, i + 10));
  }

  console.log(
    "sendMediaGroup",
    JSON.stringify({
      update_id: logContext?.updateId,
      media_group_id: logContext?.mediaGroupId,
      total_photos: fileIds.length,
      chunk_count: chunks.length,
    }),
  );

  for (const [index, chunk] of chunks.entries()) {
    const media = chunk.map((fileId) => ({ type: "photo", media: fileId }));
    await callTelegram("sendMediaGroup", { chat_id: chatId, media });
    if (index < chunks.length - 1) {
      await delay(randomBetween(MEDIA_GROUP_CHUNK_DELAY_MIN_MS, MEDIA_GROUP_CHUNK_DELAY_MAX_MS));
    }
  }
}

async function dedupeUpdate(updateId: number) {
  const { error } = await supabase.from("tg_updates").insert({ update_id: updateId });
  if (error) {
    if (error.code === "23505") {
      return true;
    }
    throw new Error(`Failed to insert update_id: ${error.message}`);
  }
  return false;
}

async function getSubmission(userId: number): Promise<Submission> {
  const { data, error } = await supabase
    .from("bot_submissions")
    .select("user_id,state,payload,photo_file_ids")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load submission: ${error.message}`);
  }

  if (data) {
    return {
      user_id: data.user_id as number,
      state: data.state as string,
      payload: (data.payload as Record<string, unknown>) ?? {},
      photo_file_ids: (data.photo_file_ids as string[]) ?? [],
    };
  }

  return {
    user_id: userId,
    state: "idle",
    payload: {},
    photo_file_ids: [],
  };
}

async function saveSubmission(submission: Submission) {
  const { error } = await supabase.from("bot_submissions").upsert({
    user_id: submission.user_id,
    state: submission.state,
    payload: submission.payload,
    photo_file_ids: submission.photo_file_ids,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to save submission: ${error.message}`);
  }
}

function formatSummary(payload: Record<string, unknown>, photoCount: number) {
  const lines = [
    "Новая фото-подборка:",
    `Дата: ${payload.date ?? "-"}`,
    `Тип: ${payload.type ?? "-"}`,
    payload.custom_type ? `Свой вариант: ${payload.custom_type}` : null,
    `Дисциплина: ${payload.discipline ?? "-"}`,
    `Пол: ${payload.gender ?? "-"}`,
    `Этап: ${payload.stage ?? "-"}`,
    `Стадия: ${payload.phase ?? "-"}`,
    `Фото: ${photoCount}`,
  ].filter(Boolean);

  return lines.join("\n");
}

function isValidDate(text: string) {
  return /^\d{2}\.\d{2}\.\d{2,4}$/.test(text.trim());
}

function pickLargestPhotoId(photos: Array<{ file_id: string; file_size?: number }>) {
  if (!photos.length) return null;
  const sorted = [...photos].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
  return sorted[sorted.length - 1].file_id;
}

async function notifyAdminError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await sendMessage(targetChatId, `Ошибка обработки: ${message}`);
  } catch (sendError) {
    console.error("Failed to notify admin", sendError);
  }
}

async function flushMediaGroup(mediaGroupId: string, logContext?: { updateId?: number }) {
  const buffer = mediaGroupBuffers.get(mediaGroupId);
  if (!buffer) return;
  mediaGroupBuffers.delete(mediaGroupId);
  console.log(
    "flushMediaGroup",
    JSON.stringify({
      update_id: logContext?.updateId,
      media_group_id: mediaGroupId,
      user_id: buffer.userId,
      photo_count: buffer.fileIds.length,
    }),
  );
  await sendMediaGroup(buffer.chatId, buffer.fileIds, {
    updateId: logContext?.updateId,
    mediaGroupId,
  });
}

function bufferMediaGroup(
  mediaGroupId: string,
  fileId: string,
  userId: number,
  chatId: number | string,
  logContext?: { updateId?: number },
) {
  const existing = mediaGroupBuffers.get(mediaGroupId);
  const buffer: MediaGroupBuffer = existing ?? { chatId, userId, fileIds: [] };
  buffer.fileIds.push(fileId);
  if (buffer.timerId) {
    clearTimeout(buffer.timerId);
  }
  buffer.timerId = setTimeout(() => {
    flushMediaGroup(mediaGroupId, logContext).catch((error) => {
      console.error("Failed to flush media group", error);
    });
  }, randomBetween(MEDIA_GROUP_FLUSH_MIN_MS, MEDIA_GROUP_FLUSH_MAX_MS));
  mediaGroupBuffers.set(mediaGroupId, buffer);
  console.log(
    "bufferMediaGroup",
    JSON.stringify({
      update_id: logContext?.updateId,
      media_group_id: mediaGroupId,
      user_id: userId,
      buffered_count: buffer.fileIds.length,
    }),
  );
}

async function handleMessage(message: TelegramMessage, updateId: number) {
  if (message.chat.type !== "private") {
    return;
  }

  if (!message.from) {
    return;
  }

  const userId = message.from.id;
  const submission = await getSubmission(userId);
  const text = message.text?.trim();

  if (text === "/start") {
    submission.state = "idle";
    submission.payload = {};
    submission.photo_file_ids = [];
    await saveSubmission(submission);
    await sendMessage(userId, "Привет! Готов принять подборку.", START_KEYBOARD);
    return;
  }

  if (text === "/cancel") {
    submission.state = "idle";
    submission.payload = {};
    submission.photo_file_ids = [];
    await saveSubmission(submission);
    await sendMessage(userId, "Диалог сброшен. Чтобы начать заново, нажмите кнопку ниже.", START_KEYBOARD);
    return;
  }

  if (text === "Отправить фото") {
    submission.state = "await_date";
    submission.payload = {};
    submission.photo_file_ids = [];
    await saveSubmission(submission);
    await sendMessage(userId, "Укажите дату (дд.мм.гг или дд.мм.гггг):");
    return;
  }

  if (submission.state === "await_date") {
    if (!text || !isValidDate(text)) {
      await sendMessage(userId, "Дата должна быть в формате дд.мм.гг или дд.мм.гггг. Попробуйте ещё раз:");
      return;
    }

    submission.payload = { ...submission.payload, date: text };
    submission.state = "await_type";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите тип:", {
      keyboard: TYPE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_type") {
    if (!text || !TYPE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите тип из списка кнопок.");
      return;
    }

    if (text === "Свой вариант") {
      submission.state = "await_custom_type";
      submission.payload = { ...submission.payload, type: text };
      await saveSubmission(submission);
      await sendMessage(userId, "Введите свой вариант типа:");
      return;
    }

    submission.payload = { ...submission.payload, type: text };
    submission.state = "await_discipline";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите дисциплину:", {
      keyboard: DISCIPLINE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_custom_type") {
    if (!text) {
      await sendMessage(userId, "Введите текст своего варианта:");
      return;
    }

    submission.payload = { ...submission.payload, custom_type: text };
    submission.state = "await_discipline";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите дисциплину:", {
      keyboard: DISCIPLINE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_discipline") {
    if (!text || !DISCIPLINE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите дисциплину из списка кнопок.");
      return;
    }

    submission.payload = {
      ...submission.payload,
      discipline: text === "Пропустить" ? "-" : text,
    };
    submission.state = "await_gender";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите категорию:", {
      keyboard: GENDER_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_gender") {
    if (!text || !GENDER_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите из кнопок: Девочки или Мальчики.");
      return;
    }

    submission.payload = { ...submission.payload, gender: text };
    submission.state = "await_stage";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите этап:", {
      keyboard: STAGE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_stage") {
    if (!text || !STAGE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите этап из списка кнопок.");
      return;
    }

    submission.payload = { ...submission.payload, stage: text };
    submission.state = "await_phase";
    await saveSubmission(submission);
    await sendMessage(userId, "Выберите стадию:", {
      keyboard: PHASE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (submission.state === "await_phase") {
    if (!text || !PHASE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите стадию из списка кнопок.");
      return;
    }

    submission.payload = { ...submission.payload, phase: text };
    submission.state = "await_photos";
    await saveSubmission(submission);
    await sendMessage(
      userId,
      "Отправьте минимум 25 фото (можно альбомом). Когда закончите, нажмите кнопку Готово ✅.",
      DONE_KEYBOARD,
    );
    return;
  }

  if (submission.state === "await_photos") {
    if (text === "Готово ✅") {
      if (submission.photo_file_ids.length < 25) {
        await sendMessage(
          userId,
          `Сейчас ${submission.photo_file_ids.length}. Нужно минимум 25 фото. Продолжайте отправку.`,
        );
        return;
      }

      const summary = formatSummary(submission.payload, submission.photo_file_ids.length);
      await sendMessage(targetChatId, summary);
      await sendMediaGroup(targetChatId, submission.photo_file_ids);

      submission.state = "idle";
      submission.payload = {};
      submission.photo_file_ids = [];
      await saveSubmission(submission);

      await sendMessage(userId, "Фото доставлены, спасибо!", START_KEYBOARD);
      return;
    }

    if (message.photo && message.photo.length > 0) {
      const photoId = pickLargestPhotoId(message.photo);
      if (photoId) {
        submission.photo_file_ids = [...submission.photo_file_ids, photoId];
        await saveSubmission(submission);
        if (message.media_group_id) {
          bufferMediaGroup(message.media_group_id, photoId, userId, targetChatId, { updateId });
        }
      }
      return;
    }

    await sendMessage(userId, "Ожидаю фото или кнопку Готово ✅.");
    return;
  }

  await sendMessage(userId, "Нажмите «Отправить фото», чтобы начать.", START_KEYBOARD);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const update = (await req.json()) as TelegramUpdate;
    console.log(
      "incomingUpdate",
      JSON.stringify({
        update_id: update.update_id,
        from_id: update.message?.from?.id,
        media_group_id: update.message?.media_group_id,
        photo_count: update.message?.photo?.length ?? 0,
      }),
    );

    if (await dedupeUpdate(update.update_id)) {
      console.log("duplicateUpdate", JSON.stringify({ update_id: update.update_id }));
      return new Response("ok", { status: 200 });
    }

    if (update.message) {
      await handleMessage(update.message, update.update_id);
    }
  } catch (error) {
    console.error("Handler error", error);
    await notifyAdminError(error);
  }

  return new Response("ok", { status: 200 });
});
