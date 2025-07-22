// testMode.js

import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getSignals } from "./analytics/indicators/index.js";
import { report } from "./analytics/report.js";
import util from "node:util";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const indicator = process.env.INDICATOR;
const appMode = process.env.MODE;
const interval = process.env.HEARTBEAT_INTERVAL;

const heartbeatInterval = getHeartbeatInterval(interval);

let loopCount = 1;

// Store current position state: symbol, stopLoss, takeProfit, shortPrice
let positionState = {
  symbol: null,
  stopLoss: null,
  takeProfit: null,
  shortPrice: null,
};

export default async function start() {
  console.log("\nTEST mode is active");

  try {
    await startServer();
    await startLoop();
  } catch (error) {
    const { statusCode, statusMessage, body, type, errorSrcData } = error;

    if (statusCode) {
      console.error(
        `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
          JSON.parse(body).msg
        }`
      );

      console.info(
        `Error source data:`,
        util.inspect(errorSrcData, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );
    } else {
      console.info(
        `\nUnexpected Error:`,
        util.inspect(error, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );
      console.info(
        `Error source data:`,
        util.inspect(errorSrcData, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );
    }
  }
}

async function startServer() {
  try {
    console.info(`${secondarySymbol} Bot started`);

    if (appMode === "PRODUCTION") console.info = () => {};

    console.info("Heartbeat interval:", interval);
    console.info("Using indicator:", indicator);
  } catch (error) {
    throw { type: "Start Server Error", ...error, errorSrcData: error };
  }
}

async function startLoop() {
  try {
    while (loopCount) {
      console.info("\n");
      console.info("-----------------------------------------------------");
      console.info("Loop start:", loopCount);

      if (appMode === "DEVELOPMENT") console.time("Loop Time");

      console.info("-----------------------------------------------------");

      await heartBeatLoop();

      console.info("\n");
      console.info("-----------------------------------------------------");
      console.info("Loop end:", loopCount);

      if (appMode === "DEVELOPMENT") console.timeEnd("Loop Time");

      console.info("-----------------------------------------------------");
      console.info("\n");

      await delay(heartbeatInterval);

      loopCount++;
    }
  } catch (error) {
    throw { type: "Start Loop Error", ...error, errorSrcData: error };
  }
}

async function heartBeatLoop() {
  try {
    const {
      symbol,
      price,
      priceChangePercent,
      signal,
      exitReason,
      stopLoss,
      takeProfit,
      shortPrice,
    } = await getSignals(positionState);

    const isBuySignal = signal === "BUY";
    const isSellSignal = signal === "SELL";

    if (isSellSignal) {
      positionState = { symbol, stopLoss, takeProfit, shortPrice };
    } else if (isBuySignal) {
      positionState = {
        symbol: null,
        stopLoss: null,
        takeProfit: null,
        shortPrice: null,
      };
    } else {
      positionState = { symbol, stopLoss, takeProfit, shortPrice };
    }

    const primarySymbol = symbol?.replace(secondarySymbol, "") || null;

    if (isBuySignal) {
      report({
        date: new Date(),
        trade: "BUY",
        symbol,
        price,
        priceChangePercent,
        exitReason,
      });
    } else if (isSellSignal) {
      report({
        date: new Date(),
        trade: "SELL",
        symbol,
        price,
        priceChangePercent,
      });
    } else {
      report({
        date: new Date(),
        trade: primarySymbol ? "HOLD" : null,
        symbol,
        price,
        priceChangePercent,
      });
    }
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}
