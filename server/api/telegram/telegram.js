// telegram.js

import { Telegram } from "telegraf";

const token = process.env.TELEGRAM_ACCESS_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const useTelegram = JSON.parse(process.env.USE_TELEGRAM);

const telegram = new Telegram(token);

export async function sendMessage(message) {
  if (!useTelegram) return;

  try {
    await telegram.sendMessage(channelId, message, {
      parse_mode: "HTML",
    });
  } catch (error) {
    throw { type: "Telegram Send Error", ...error };
  }
}

export async function sendImage(image) {
  if (!useTelegram) return;

  try {
    await telegram.sendPhoto(channelId, {
      source: image,
    });
  } catch (error) {
    throw { type: "Telegram Image Error", ...error };
  }
}
