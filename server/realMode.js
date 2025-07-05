// realMode.js

import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getSignals } from "./analytics/indicators/index.js";
import {
  getFuturesAccountBalances,
  createMarketOrder,
  getLastPrice,
} from "./api/binance/trade.js";
import util from "node:util";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const appMode = process.env.MODE;
const interval = process.env.HEARTBEAT_INTERVAL;
const heartbeatInterval = getHeartbeatInterval(interval);

const useFixedTradeValue = process.env.USE_FIXED_TRADE_VALUE === "true";
const tradeValue = parseFloat(process.env.TRADE_VALUE || "0"); // fixed value or percentage

let loopCount = 1;

export default async function start() {
  console.log("\nTRADE mode is active");

  try {
    await startServer();
    await startLoop();
  } catch (error) {
    handleError(error);
  }
}

async function startServer() {
  try {
    console.info(`${secondarySymbol} Bot started`);

    if (appMode === "PRODUCTION") console.info = () => {};

    console.info("Heartbeat interval:", interval);
    console.info("Trade mode active");

    const balances = await getFuturesAccountBalances();
    console.info("Initial futures balances:", balances);
  } catch (error) {
    throw { type: "Start Server Error", ...error, errorSrcData: error };
  }
}

async function startLoop() {
  try {
    while (loopCount) {
      console.info("\n-----------------------------------------------------");
      console.info("Loop start:", loopCount);
      if (appMode === "DEVELOPMENT") console.time("Loop Time");
      console.info("-----------------------------------------------------");

      await heartBeatLoop();

      console.info("\n-----------------------------------------------------");
      console.info("Loop end:", loopCount);
      if (appMode === "DEVELOPMENT") console.timeEnd("Loop Time");
      console.info("-----------------------------------------------------\n");

      await delay(heartbeatInterval);

      loopCount++;
    }
  } catch (error) {
    throw { type: "Start Loop Error", ...error, errorSrcData: error };
  }
}

async function heartBeatLoop() {
  try {
    const { symbol, price, signal } = await getSignals();

    const isBuySignal = signal === "BUY";
    const isSellSignal = signal === "SELL";
    const primarySymbol = symbol?.split(secondarySymbol)[0] || null;
    const fullSymbol = `${primarySymbol}${secondarySymbol}`;

    if (!isBuySignal && !isSellSignal) {
      console.info(`No trade signal for ${fullSymbol}`);
      return;
    }

    const quantity = await calculateTradeQuantity(fullSymbol, price);
    console.info(
      `${signal} signal detected for ${fullSymbol} at price ${price}, quantity ${quantity}`
    );

    await createMarketOrder({
      symbol: fullSymbol,
      side: isSellSignal ? "SELL" : "BUY",
      quantity,
      type: "MARKET",
    });

    console.info("Checking account balances after trade...");
    const balances = await getFuturesAccountBalances();
    console.info("Futures balances:", balances);
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}

async function calculateTradeQuantity(symbol, lastKnownPrice) {
  try {
    let price = lastKnownPrice;
    if (!price) {
      price = await getLastPrice(symbol);
    }

    if (!price || price <= 0) {
      throw new Error(`Invalid price for symbol ${symbol}: ${price}`);
    }

    let quoteAmount;

    if (useFixedTradeValue) {
      // Fixed value in quote currency
      quoteAmount = tradeValue;
    } else {
      // Percentage from total futures balance in quote currency
      const balances = await getFuturesAccountBalances();
      const quoteBalance =
        balances.find((b) => b.symbol === secondarySymbol)?.available || 0;

      if (!quoteBalance) {
        throw new Error(`No balance found for ${secondarySymbol}`);
      }

      quoteAmount = (quoteBalance * tradeValue) / 100;
    }

    const quantity = quoteAmount / price;

    return parseFloat(quantity.toFixed(8));
  } catch (error) {
    throw {
      type: "Trade Quantity Calculation Error",
      ...error,
      errorSrcData: error,
    };
  }
}

function handleError(error) {
  const { statusCode, statusMessage, body, type, errorSrcData } = error;

  if (statusCode) {
    console.error(
      `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${JSON.parse(body).msg}`
    );
    console.info(
      "Error source data:",
      util.inspect(errorSrcData, {
        showHidden: false,
        depth: null,
        colors: true,
      })
    );
  } else {
    console.info(
      "\nUnexpected Error:",
      util.inspect(error, { showHidden: false, depth: null, colors: true })
    );
    console.info(
      "Error source data:",
      util.inspect(errorSrcData, {
        showHidden: false,
        depth: null,
        colors: true,
      })
    );
  }
}
