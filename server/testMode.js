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
    // Note: Unlike realMode.js, testMode.js typically doesn't close existing positions on start
    // unless specifically designed to do so.
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
    const isNoSignal = signal === null;

    // --- FIXED POSITION STATE LOGIC ---
    // Update state only on actual entry or exit signals
    if (isSellSignal) {
      // Open a new position (or confirm existing one)
      // In test mode, we just update the state as if the order was filled
      positionState = { symbol, stopLoss, takeProfit, shortPrice };
      console.info(
        `Test Mode: Simulating SHORT OPEN on ${symbol} at price ${price}`
      );

      // --- Generate SELL report AFTER updating state ---
      report({
        date: new Date(),
        trade: "SELL",
        symbol,
        price,
        priceChangePercent,
      });
      // --- End of change ---
    } else if (isBuySignal) {
      // --- Generate BUY report BEFORE resetting state ---
      // Use symbol from the signal or fallback to state if signal didn't provide it
      const closedSymbol = symbol || positionState.symbol;
      report({
        date: new Date(),
        trade: "BUY",
        symbol: closedSymbol, // Use potentially corrected symbol
        price,
        priceChangePercent,
        exitReason,
      });
      // --- End of change ---

      // Close the position
      console.info(
        `Test Mode: Simulating SHORT CLOSE on ${positionState.symbol} at price ${price}`
      );
      positionState = {
        symbol: null,
        stopLoss: null,
        takeProfit: null,
        shortPrice: null,
      };
    }
    // If isNoSignal, positionState is NOT changed.
    // It retains information about the currently open position.
    // This prevents a new SELL signal for a different pair from overriding
    // the state of an existing open position.
    // --- END OF FIXES ---

    // Handle HOLD and PASS cases when there's no specific buy/sell signal
    if (isNoSignal) {
      // For test mode, HOLD makes sense only if there's an open position
      const tradeType = positionState.symbol ? "HOLD" : null;
      report({
        date: new Date(),
        trade: tradeType,
        symbol: positionState.symbol, // Show the symbol of the held position
        price,
        priceChangePercent,
      });
    }
    // Note: SELL and BUY reports are handled above in their respective blocks
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}
