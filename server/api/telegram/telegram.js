import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_ACCESS_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const useTelegram = JSON.parse(process.env.USE_TELEGRAM);

const bot = new Telegraf(token);

try {
  if (useTelegram) {
    await bot.launch();
  }
} catch (error) {
  throw { type: "Bot Launch Error", ...error, errorSrcData: error };
}

export async function sendMessage(message) {
  if (!useTelegram) return

  try {
    await bot.telegram.sendMessage(channelId, message, { parse_mode: "HTML" });
  } catch (error) {
    throw { type: "Sent Message Error", ...error, errorSrcData: error };
  }
}

export async function sendImage(image) {
  if (!useTelegram) return

  try {
    await bot.telegram.sendPhoto(channelId, {
      source: image,
    });
  } catch (error) {
    throw { type: "Send Image Error", ...error, errorSrcData: error };
  }
}

if (useTelegram) {
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
