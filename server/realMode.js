// realMode.js

import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getSignals } from "./analytics/indicators/index.js";
import {
  getAccountBalancesFutures,
  getFuturesPositionsFutures,
  getSymbolMinTradeFutures,
  getLastPriceFutures,
  getFuturesAccountUSDTBalance,
} from "./api/binance/info.js";
import {
  createMarketOrderFutures,
  closeMarketOrderFutures,
} from "./api/binance/trading.js";
import util from "node:util";
import { report } from "./analytics/report.js";

const onlyCleanBalance = process.env.ONLY_CLEAN_BALANCE === "true";
const secondarySymbol = process.env.SECONDARY_SYMBOL;
const appMode = process.env.MODE;
const interval = process.env.HEARTBEAT_INTERVAL;
const heartbeatInterval = getHeartbeatInterval(interval);

const useFixedTradeValue = process.env.USE_FIXED_TRADE_VALUE === "true";
const tradeValue = parseFloat(process.env.TRADE_VALUE);
const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT);

let loopCount = 1;

// Store full position state: symbol, stopLoss, takeProfit, shortPrice
let positionState = {
  symbol: null,
  stopLoss: null,
  takeProfit: null,
  shortPrice: null,
};

export default async function start() {
  console.log("\nTRADE mode is active");

  try {
    await startServer();

    await closeAllClosablePositions();

    if (onlyCleanBalance) {
      console.info(
        "ONLY_CLEAN_BALANCE is true. Stopping bot after clearing balance."
      );
      console.info("Bot stopped.");
      return;
    }

    await startLoop();
  } catch (error) {
    handleError(error);
  }
}

async function startServer() {
  console.info(`${secondarySymbol} Bot started`);

  if (appMode === "PRODUCTION") console.info = () => {};

  console.info("Heartbeat interval:", interval);
  console.info("Trade mode active");

  const balances = await getAccountBalancesFutures();
  console.info("Initial futures balances:", balances);
}

async function startLoop() {
  while (loopCount) {
    console.info("\n-----------------------------------------------------");
    console.info("Loop start:", loopCount);
    if (appMode === "DEVELOPMENT") console.time("Loop Time");
    console.info("-----------------------------------------------------");

    await tradeBySignal();

    console.info("\n-----------------------------------------------------");
    console.info("Loop end:", loopCount);
    if (appMode === "DEVELOPMENT") console.timeEnd("Loop Time");
    console.info("-----------------------------------------------------\n");

    await delay(heartbeatInterval);
    loopCount++;
  }
}

async function tradeBySignal() {
  const { symbol, price, priceChangePercent, signal, stopLoss, takeProfit } =
    await getSignals(positionState);

  const isSellSignal = signal === "SELL";

  // 1. No signal and no open position: send empty report
  if (!signal && !positionState.symbol) {
    report({
      date: new Date(),
      trade: null,
      symbol: null,
      price: null,
      priceChangePercent: 0,
    });

    console.info("No signal detected and no open position");

    return;
  }

  // 2. No signal but there is an open position: HOLD
  if (!signal && positionState.symbol) {
    report({
      date: new Date(),
      trade: "HOLD",
      symbol: positionState.symbol,
      price: price ?? null,
      priceChangePercent: priceChangePercent ?? 0,
    });

    console.info(
      `No trade signal, holding position on ${positionState.symbol}`
    );

    return;
  }

  // 3. SELL signal but already have a short on the same symbol: HOLD
  if (isSellSignal && positionState.symbol === symbol) {
    console.info(`Already in short on ${symbol}, holding`);
    report({
      date: new Date(),
      trade: "HOLD",
      symbol,
      price: price ?? null,
      priceChangePercent: priceChangePercent ?? 0,
    });

    return;
  }

  // 4. If SELL signal and no open position: close any old positions, then open short
  if (isSellSignal && !positionState.symbol) {
    console.info(
      `Preparing to open short on ${symbol}: clearing all open positions`
    );

    await closeAllClosablePositions(); // Always clear old positions before opening new

    const quantity = await calculateTradeQuantity(symbol, price);
    const notional = quantity * price;

    if (quantity <= 0) {
      console.info(
        `Calculated quantity is too small for ${symbol}, skipping trade`
      );

      report({
        date: new Date(),
        trade: "PASS",
        symbol,
        price: price ?? null,
        priceChangePercent: priceChangePercent ?? 0,
      });
      return;
    }

    const usdtBalance = await getFuturesAccountUSDTBalance();

    if (notional > usdtBalance) {
      console.info(
        `Not enough balance to open trade on ${symbol}: ${usdtBalance.toFixed(2)} USDT`
      );

      report({
        date: new Date(),
        trade: "PASS",
        symbol,
        price: price ?? null,
        priceChangePercent: priceChangePercent ?? 0,
      });

      return;
    }

    try {
      const order = await createMarketOrderFutures({
        symbol,
        side: "SELL",
        quantity,
      });

      console.info(
        `Trade executed for SELL on ${symbol}, order response:`,
        order
      );

      const executedPrice = parseFloat(order.avgPrice || order.price || price);

      positionState = {
        symbol,
        stopLoss,
        takeProfit,
        shortPrice: executedPrice,
      };

      report({
        date: new Date(),
        trade: "SELL",
        symbol,
        price: executedPrice,
        priceChangePercent,
      });
    } catch (err) {
      console.error(`Error creating SELL order for ${symbol}:`, err);

      report({
        date: new Date(),
        trade: "PASS",
        symbol,
        price: price ?? null,
        priceChangePercent: priceChangePercent ?? 0,
      });
    }

    return;
  }

  // 5. If BUY signal and there is an open position: close it, send BUY report, do not open new position
  if (!isSellSignal && positionState.symbol) {
    console.info(
      `Signal is ${signal || "undefined"}, closing open position on ${positionState.symbol}`
    );

    await closeAllClosablePositions();

    report({
      date: new Date(),
      trade: "BUY",
      symbol: positionState.symbol,
      price: price ?? null,
      priceChangePercent: priceChangePercent ?? 0,
    });

    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };

    return;
  }

  // 6. If BUY signal and no position: nothing to do
  if (!isSellSignal && !positionState.symbol) {
    console.info(`Signal is ${signal}, but no position open. Skipping trade.`);

    report({
      date: new Date(),
      trade: "PASS",
      symbol,
      price: price ?? null,
      priceChangePercent: priceChangePercent ?? 0,
    });

    return;
  }
}

async function closeAllClosablePositions() {
  console.info(">>> closeAllClosablePositions() started");

  try {
    const positions = await getFuturesPositionsFutures();
    console.info(`Got ${positions.length} positions from API`);

    const openPositions = positions.filter(
      (p) => parseFloat(p.positionAmt) !== 0
    );
    console.info(`Filtered to ${openPositions.length} open positions`);

    if (openPositions.length === 0) {
      console.info("No open positions");
      return;
    }

    for (const pos of openPositions) {
      const positionAmt = parseFloat(pos.positionAmt);
      const markPrice = parseFloat(pos.markPrice);
      const notional = Math.abs(positionAmt) * markPrice;

      const { stepSize, minQty, minNotional } = await getSymbolMinTradeFutures(
        pos.symbol
      );
      const closable =
        Math.abs(positionAmt) >= stepSize &&
        Math.abs(positionAmt) >= minQty &&
        notional >= (minNotional || 0);

      if (!closable) {
        console.info(
          `Position ${pos.symbol} not closable: dust amount ${positionAmt}`
        );
        continue;
      }

      const closeSide = positionAmt > 0 ? "SELL" : "BUY";
      console.info(
        `Closing ${pos.symbol} position, amount: ${Math.abs(positionAmt)}`
      );

      try {
        const result = await closeMarketOrderFutures({
          symbol: pos.symbol,
          side: closeSide,
          quantity: Math.abs(positionAmt),
          positionSide: pos.positionSide || "BOTH",
        });
        console.info(`${pos.symbol} closed, response:`, result);
      } catch (error) {
        console.error(`Failed to close ${pos.symbol}:`, error);
      }
    }
  } catch (error) {
    console.error("Error in closeAllClosablePositions:", error);
  }
}

async function calculateTradeQuantity(symbol, lastPrice) {
  try {
    const price = lastPrice || (await getLastPriceFutures(symbol));
    const balances = await getAccountBalancesFutures();

    const quoteBalance =
      balances.find((b) => b.symbol === secondarySymbol)?.available || 0;
    if (!price || price <= 0 || !quoteBalance || quoteBalance <= 0) return 0;

    let quoteAmount = useFixedTradeValue
      ? tradeValue
      : (quoteBalance * tradeValue) / 100;
    const availableForTrade = quoteAmount * (1 - commissionPercent / 100);
    if (availableForTrade <= 0) return 0;

    const { stepSize, minQty } = await getSymbolMinTradeFutures(symbol);
    const rawQty = availableForTrade / price;
    const precision = (stepSize.toString().split(".")[1] || []).length;
    const quantity = Math.floor(rawQty / stepSize) * stepSize;

    return quantity < minQty ? 0 : parseFloat(quantity.toFixed(precision));
  } catch (error) {
    console.error(`Error calculating trade quantity for ${symbol}:`, error);
    return 0;
  }
}

function handleError(error) {
  const { statusCode, statusMessage, body, type, errorSrcData } = error;

  if (statusCode) {
    console.error(
      `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${JSON.parse(body).msg}`
    );
  }

  console.info(
    "Error source data:",
    util.inspect(errorSrcData, { depth: null, colors: true })
  );
}
