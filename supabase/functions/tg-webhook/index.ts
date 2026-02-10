import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Submission = {
  id: string;
  user_id: number;
  chat_id: number;
  created_at: string;
  kind: string;
  event_date: string | null;
  event_type: string | null;
  custom_event_type: string | null;
  sport: string | null;
  gender: string | null;
  stage: string | null;
  phase: string | null;
  achievement_text: string | null;
  photo_file_ids: string[];
  photo_unique_ids: string[];
  status: string;
  attempts: number;
  last_error: string | null;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  photo?: Array<{ file_id: string; file_unique_id?: string; file_size?: number }>;
  media_group_id?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const TELEGRAM_API = "https://api.telegram.org";

const START_KEYBOARD = {
  keyboard: [[{ text: "🏆 Соревнования ШСК" }], [{ text: "🌟 Достижения детей" }]],
  resize_keyboard: true,
};

const PHOTO_ACTIONS_KEYBOARD = {
  keyboard: [[{ text: "Готово ✅" }, { text: "Отмена" }]],
  resize_keyboard: true,
};

const RETRY_ACTIONS_KEYBOARD = {
  keyboard: [[{ text: "Повторить отправку" }, { text: "Отмена" }]],
  resize_keyboard: true,
};

const CONFIRM_ACTIONS_KEYBOARD = {
  keyboard: [[{ text: "➕ Добавить фото" }], [{ text: "✅ Отправить" }, { text: "❌ Отмена" }]],
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

const RECOMMENDED_PHOTOS = 25;
const MAX_ACHIEVEMENT_TEXT_LENGTH = 700;

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

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(`Telegram API error (${method}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function sendMessage(chatId: number | string, text: string, replyMarkup?: unknown) {
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
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

async function getActiveSubmission(userId: number): Promise<Submission | null> {
  const { data, error } = await supabase
    .from("bot_submissions")
    .select(
      "id,user_id,chat_id,created_at,kind,event_date,event_type,custom_event_type,sport,gender,stage,phase,achievement_text,photo_file_ids,photo_unique_ids,status,attempts,last_error",
    )
    .eq("user_id", userId)
    .in("status", ["collecting", "confirming", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load submission: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id as string,
    user_id: data.user_id as number,
    chat_id: data.chat_id as number,
    created_at: data.created_at as string,
    kind: (data.kind as string) ?? "competition",
    event_date: (data.event_date as string | null) ?? null,
    event_type: (data.event_type as string | null) ?? null,
    custom_event_type: (data.custom_event_type as string | null) ?? null,
    sport: (data.sport as string | null) ?? null,
    gender: (data.gender as string | null) ?? null,
    stage: (data.stage as string | null) ?? null,
    phase: (data.phase as string | null) ?? null,
    achievement_text: (data.achievement_text as string | null) ?? null,
    photo_file_ids: (data.photo_file_ids as string[]) ?? [],
    photo_unique_ids: (data.photo_unique_ids as string[]) ?? (data.photo_file_ids as string[]) ?? [],
    status: data.status as string,
    attempts: (data.attempts as number) ?? 0,
    last_error: (data.last_error as string | null) ?? null,
  };
}

async function createSubmission(userId: number, chatId: number, kind: "competition" | "achievement"): Promise<Submission> {
  const { data, error } = await supabase
    .from("bot_submissions")
    .insert({
      user_id: userId,
      chat_id: chatId,
      kind,
      status: "collecting",
      photo_file_ids: [],
      photo_unique_ids: [],
    })
    .select(
      "id,user_id,chat_id,created_at,kind,event_date,event_type,custom_event_type,sport,gender,stage,phase,achievement_text,photo_file_ids,photo_unique_ids,status,attempts,last_error",
    )
    .single();

  if (error) {
    throw new Error(`Failed to create submission: ${error.message}`);
  }

  return {
    id: data.id as string,
    user_id: data.user_id as number,
    chat_id: data.chat_id as number,
    created_at: data.created_at as string,
    kind: (data.kind as string) ?? "competition",
    event_date: (data.event_date as string | null) ?? null,
    event_type: (data.event_type as string | null) ?? null,
    custom_event_type: (data.custom_event_type as string | null) ?? null,
    sport: (data.sport as string | null) ?? null,
    gender: (data.gender as string | null) ?? null,
    stage: (data.stage as string | null) ?? null,
    phase: (data.phase as string | null) ?? null,
    achievement_text: (data.achievement_text as string | null) ?? null,
    photo_file_ids: (data.photo_file_ids as string[]) ?? [],
    photo_unique_ids: (data.photo_unique_ids as string[]) ?? [],
    status: data.status as string,
    attempts: (data.attempts as number) ?? 0,
    last_error: (data.last_error as string | null) ?? null,
  };
}

async function updateSubmission(submission: Submission) {
  const { error } = await supabase
    .from("bot_submissions")
    .update({
      event_date: submission.event_date,
      event_type: submission.event_type,
      custom_event_type: submission.custom_event_type,
      sport: submission.sport,
      gender: submission.gender,
      stage: submission.stage,
      phase: submission.phase,
      achievement_text: submission.achievement_text,
      photo_file_ids: submission.photo_file_ids,
      photo_unique_ids: submission.photo_unique_ids,
      status: submission.status,
      attempts: submission.attempts,
      last_error: submission.last_error,
    })
    .eq("id", submission.id);

  if (error) {
    throw new Error(`Failed to save submission: ${error.message}`);
  }
}

function buildSubmissionHeader(submission: Submission) {
  if (submission.kind === "achievement") {
    return ["🌟 Достижения детей", submission.achievement_text ?? "", ""].join("\n");
  }

  const eventType =
    submission.event_type === "Свой вариант" ? submission.custom_event_type ?? "" : submission.event_type ?? "";

  return [
    "[",
    submission.event_date ?? "",
    eventType,
    submission.sport ?? "",
    submission.gender ?? "",
    submission.stage ?? "",
    submission.phase ?? "",
    "]",
    "",
  ].join("\n");
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function sendSubmissionToTarget(submission: Submission) {
  const header = buildSubmissionHeader(submission);
  const photos = submission.photo_file_ids;
  const batches = chunkArray(photos, 10);

  console.log(
    "submission_delivery_start",
    JSON.stringify({
      submission_id: submission.id,
      photo_count: photos.length,
      target_chat_id: targetChatId,
      batch_count: batches.length,
    }),
  );

  const results: unknown[] = [];
  const headerResult = await callTelegram("sendMessage", {
    chat_id: targetChatId,
    text: header,
  });
  results.push({ method: "sendMessage", result: headerResult });

  for (let i = 0; i < batches.length; i += 1) {
    const media = batches[i].map((fileId) => ({ type: "photo", media: fileId }));
    const batchResult = await callTelegram("sendMediaGroup", {
      chat_id: targetChatId,
      media,
    });
    results.push({ method: "sendMediaGroup", batch_index: i, result: batchResult });
  }

  console.log(
    "submission_delivery_success",
    JSON.stringify({
      submission_id: submission.id,
      photo_count: photos.length,
      target_chat_id: targetChatId,
      telegram_results: results,
    }),
  );
}

type AppendPhotoResult = {
  photoCount: number;
  added: boolean;
  rpcReturnShape: "array" | "object";
};

async function appendSubmissionPhoto(
  submissionId: string,
  fileId: string,
  uniqueId: string,
): Promise<AppendPhotoResult> {
  const { data, error } = await supabase.rpc("append_submission_photo", {
    p_submission_id: submissionId,
    p_file_id: fileId,
    p_unique_id: uniqueId,
  });

  if (error) {
    throw new Error(`Failed to append photo: ${error.message}`);
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error("empty result");
  }

  const rpcReturnShape: "array" | "object" = Array.isArray(data) ? "array" : "object";
  const record = Array.isArray(data) ? data[0] : data;

  if (!record) {
    throw new Error("empty result");
  }

  return {
    photoCount: (record.photo_count as number) ?? 0,
    added: (record.added as boolean) ?? false,
    rpcReturnShape,
  };
}

function getSubmissionStep(submission: Submission) {
  if (submission.kind === "achievement") {
    if (!submission.achievement_text) return "await_achievement_text";
    return "await_photos";
  }

  if (!submission.event_date) return "await_date";
  if (!submission.event_type) return "await_type";
  if (submission.event_type === "Свой вариант" && !submission.custom_event_type) return "await_custom_type";
  if (!submission.sport) return "await_sport";
  if (!submission.gender) return "await_gender";
  if (!submission.stage) return "await_stage";
  if (!submission.phase) return "await_phase";
  return "await_photos";
}

function isValidDate(text: string) {
  return /^\d{2}\.\d{2}\.\d{2,4}$/.test(text.trim());
}

function pickLargestPhoto(
  photos: Array<{ file_id: string; file_unique_id?: string; file_size?: number }>,
) {
  if (!photos.length) return null;
  const sorted = [...photos].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
  return sorted[sorted.length - 1];
}

function getPhotoDedupKey(photo: { file_id: string; file_unique_id?: string }) {
  return photo.file_unique_id ?? photo.file_id;
}

async function notifyAdminError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await sendMessage(targetChatId, `Ошибка обработки: ${message}`);
  } catch (sendError) {
    console.error("Failed to notify admin", sendError);
  }
}

async function handleIncomingPhoto(submission: Submission, message: TelegramMessage, userId: number) {
  if (!message.photo || message.photo.length === 0) {
    return false;
  }

  const photo = pickLargestPhoto(message.photo);
  if (!photo) {
    return false;
  }

  const dedupeKey = getPhotoDedupKey(photo);
  const { photoCount, added, rpcReturnShape } = await appendSubmissionPhoto(
    submission.id,
    photo.file_id,
    dedupeKey,
  );

  if (!added) {
    console.log(
      "duplicate_photo_skipped",
      JSON.stringify({
        chat_id: message.chat.id,
        from_id: userId,
        message_id: message.message_id,
        media_group_id: message.media_group_id ?? null,
        file_id: photo.file_id,
        file_unique_id: photo.file_unique_id ?? null,
        total_photos_in_session: photoCount,
      }),
    );
    return true;
  }

  const count = photoCount;
  console.log(
    "accepted_photo",
    JSON.stringify({
      chat_id: message.chat.id,
      from_id: userId,
      message_id: message.message_id,
      media_group_id: message.media_group_id ?? null,
      file_id: photo.file_id,
      file_unique_id: photo.file_unique_id ?? null,
      rpc_return_shape: rpcReturnShape,
      total_photos_in_session: count,
    }),
  );

  return true;
}

async function handleMessage(message: TelegramMessage) {
  if (message.chat.type !== "private") {
    return;
  }

  if (!message.from) {
    return;
  }

  const userId = message.from.id;
  const chatId = message.chat.id;
  const submission = await getActiveSubmission(userId);
  const text = message.text?.trim();

  if (text === "/start") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "cancelled_by_user";
      await updateSubmission(submission);
    }
    await sendMessage(userId, "Привет! Выберите, что хотите отправить.", START_KEYBOARD);
    return;
  }

  if (text === "/cancel") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "cancelled_by_user";
      await updateSubmission(submission);
    }
    await sendMessage(userId, "Диалог сброшен. Чтобы начать заново, выберите сценарий ниже.", START_KEYBOARD);
    return;
  }

  if (text === "Отмена") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "cancelled_by_user";
      await updateSubmission(submission);
    }
    await sendMessage(userId, "Заявка отменена. Чтобы начать заново, выберите сценарий ниже.", START_KEYBOARD);
    return;
  }

  if (text === "❌ Отмена") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "cancelled_by_user";
      await updateSubmission(submission);
    }
    await sendMessage(userId, "Заявка отменена. Чтобы начать заново, выберите сценарий ниже.", START_KEYBOARD);
    return;
  }

  if (text === "🏆 Соревнования ШСК") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "restart_by_user";
      await updateSubmission(submission);
    }
    await createSubmission(userId, chatId, "competition");
    await sendMessage(userId, "Укажите дату (дд.мм.гг или дд.мм.гггг):");
    return;
  }

  if (text === "🌟 Достижения детей") {
    if (submission) {
      submission.status = "failed";
      submission.last_error = "restart_by_user";
      await updateSubmission(submission);
    }
    await createSubmission(userId, chatId, "achievement");
    await sendMessage(userId, "Опишите достижение детей (до 700 символов):");
    return;
  }

  if (!submission) {
    await sendMessage(userId, "Выберите сценарий на клавиатуре ниже, чтобы начать.", START_KEYBOARD);
    return;
  }

  if (submission.status === "failed") {
    if (text === "Повторить отправку") {
      if (submission.photo_file_ids.length === 0) {
        await sendMessage(userId, "Не вижу фото для отправки. Пришлите фото и нажмите «Готово ✅».", PHOTO_ACTIONS_KEYBOARD);
        submission.status = "collecting";
        await updateSubmission(submission);
        return;
      }

      try {
        await sendSubmissionToTarget(submission);
        submission.status = "sent";
        submission.last_error = null;
        await updateSubmission(submission);
        await sendMessage(userId, "Фото доставлены, спасибо!", START_KEYBOARD);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        submission.attempts += 1;
        submission.last_error = errorMessage;
        await updateSubmission(submission);
        console.error(
          "submission_delivery_error",
          JSON.stringify({
            submission_id: submission.id,
            photo_count: submission.photo_file_ids.length,
            target_chat_id: targetChatId,
            error: errorMessage,
          }),
        );
        await sendMessage(
          userId,
          "Не удалось доставить фото в группу. Проверьте и нажмите «Повторить отправку», либо отмените заявку.",
          RETRY_ACTIONS_KEYBOARD,
        );
      }
      return;
    }

    if (await handleIncomingPhoto(submission, message, userId)) {
      submission.status = "collecting";
      await updateSubmission(submission);
      return;
    }

    await sendMessage(
      userId,
      "Последняя отправка не удалась. Нажмите «Повторить отправку» или «Отмена».",
      RETRY_ACTIONS_KEYBOARD,
    );
    return;
  }

  if (submission.status === "confirming") {
    if (text === "➕ Добавить фото") {
      submission.status = "collecting";
      await updateSubmission(submission);
      await sendMessage(userId, "Добавляйте фото и нажмите «Готово ✅», когда закончите.", PHOTO_ACTIONS_KEYBOARD);
      return;
    }

    if (text === "✅ Отправить") {
      try {
        await sendSubmissionToTarget(submission);
        submission.status = "sent";
        submission.last_error = null;
        await updateSubmission(submission);
        await sendMessage(userId, "Фото доставлены, спасибо!", START_KEYBOARD);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        submission.status = "failed";
        submission.attempts += 1;
        submission.last_error = errorMessage;
        await updateSubmission(submission);
        console.error(
          "submission_delivery_error",
          JSON.stringify({
            submission_id: submission.id,
            photo_count: submission.photo_file_ids.length,
            target_chat_id: targetChatId,
            error: errorMessage,
          }),
        );
        await sendMessage(
          userId,
          "Не удалось доставить фото в группу. Нажмите «Повторить отправку» или «Отмена».",
          RETRY_ACTIONS_KEYBOARD,
        );
      }
      return;
    }

    await sendMessage(userId, "Выберите действие: добавить фото, отправить или отменить.", CONFIRM_ACTIONS_KEYBOARD);
    return;
  }

  if (submission.status !== "collecting") {
    await sendMessage(userId, "Выберите сценарий на клавиатуре ниже, чтобы начать.", START_KEYBOARD);
    return;
  }

  const step = getSubmissionStep(submission);


  if (step === "await_achievement_text") {
    if (!text) {
      await sendMessage(userId, "Текст достижения не должен быть пустым. Попробуйте ещё раз:");
      return;
    }

    if (text.length > MAX_ACHIEVEMENT_TEXT_LENGTH) {
      await sendMessage(
        userId,
        `Текст слишком длинный (${text.length} символов). Пожалуйста, сократите до ${MAX_ACHIEVEMENT_TEXT_LENGTH} символов.`,
      );
      return;
    }

    submission.achievement_text = text;
    await updateSubmission(submission);
    await sendMessage(
      userId,
      `Рекомендуем минимум ${RECOMMENDED_PHOTOS} фото хорошего качества (можно меньше)`,
      PHOTO_ACTIONS_KEYBOARD,
    );
    return;
  }

  if (step === "await_date") {
    if (!text || !isValidDate(text)) {
      await sendMessage(userId, "Дата должна быть в формате дд.мм.гг или дд.мм.гггг. Попробуйте ещё раз:");
      return;
    }

    submission.event_date = text;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите тип:", {
      keyboard: TYPE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_type") {
    if (!text || !TYPE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите тип из списка кнопок.");
      return;
    }

    if (text === "Свой вариант") {
      submission.event_type = text;
      submission.custom_event_type = null;
      await updateSubmission(submission);
      await sendMessage(userId, "Введите свой вариант типа:");
      return;
    }

    submission.event_type = text;
    submission.custom_event_type = null;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите дисциплину:", {
      keyboard: DISCIPLINE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_custom_type") {
    if (!text) {
      await sendMessage(userId, "Введите текст своего варианта:");
      return;
    }

    submission.custom_event_type = text;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите дисциплину:", {
      keyboard: DISCIPLINE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_sport") {
    if (!text || !DISCIPLINE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите дисциплину из списка кнопок.");
      return;
    }

    submission.sport = text === "Пропустить" ? null : text;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите категорию:", {
      keyboard: GENDER_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_gender") {
    if (!text || !GENDER_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите из кнопок: Девочки или Мальчики.");
      return;
    }

    submission.gender = text;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите этап:", {
      keyboard: STAGE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_stage") {
    if (!text || !STAGE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите этап из списка кнопок.");
      return;
    }

    submission.stage = text;
    await updateSubmission(submission);
    await sendMessage(userId, "Выберите стадию:", {
      keyboard: PHASE_OPTIONS.map((option) => [{ text: option }]),
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (step === "await_phase") {
    if (!text || !PHASE_OPTIONS.includes(text)) {
      await sendMessage(userId, "Пожалуйста, выберите стадию из списка кнопок.");
      return;
    }

    submission.phase = text;
    await updateSubmission(submission);
    await sendMessage(
      userId,
      `Рекомендуем минимум ${RECOMMENDED_PHOTOS} фото хорошего качества (можно меньше)`,
      PHOTO_ACTIONS_KEYBOARD,
    );
    return;
  }

  if (step === "await_photos") {
    if (text === "Готово ✅") {
      if (submission.photo_file_ids.length === 0) {
        await sendMessage(userId, "Пока нет фото. Отправьте изображения и нажмите «Готово ✅».", PHOTO_ACTIONS_KEYBOARD);
        return;
      }

      submission.status = "confirming";
      await updateSubmission(submission);
      await sendMessage(
        userId,
        `Принято фото: ${submission.photo_file_ids.length}. Что делаем?`,
        CONFIRM_ACTIONS_KEYBOARD,
      );
      return;
    }

    if (await handleIncomingPhoto(submission, message, userId)) {
      return;
    }

    await sendMessage(userId, "Ожидаю фото или кнопку «Готово ✅».");
    return;
  }

  if (await handleIncomingPhoto(submission, message, userId)) {
    return;
  }

  await sendMessage(userId, "Выберите сценарий на клавиатуре ниже, чтобы начать.", START_KEYBOARD);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = performance.now();
  try {
    const update = (await req.json()) as TelegramUpdate;
    console.log(
      "incomingUpdate",
      JSON.stringify({
        update_id: update.update_id,
        from_id: update.message?.from?.id,
        media_group_id: update.message?.media_group_id,
        photo_count: update.message?.photo?.length ?? 0,
        has_text: Boolean(update.message?.text),
      }),
    );

    if (await dedupeUpdate(update.update_id)) {
      console.log("duplicateUpdate", JSON.stringify({ update_id: update.update_id }));
      return new Response("ok", { status: 200 });
    }

    if (update.message) {
      await handleMessage(update.message);
    }
  } catch (error) {
    console.error("Handler error", error);
    await notifyAdminError(error);
  } finally {
    const durationMs = Math.round(performance.now() - startTime);
    console.log("requestComplete", JSON.stringify({ duration_ms: durationMs }));
  }

  return new Response("ok", { status: 200 });
});