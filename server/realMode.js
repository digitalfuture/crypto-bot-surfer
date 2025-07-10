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
  const {
    symbol,
    price,
    priceChangePercent,
    signal,
    stopLoss,
    takeProfit,
    shortPrice,
  } = await getSignals(positionState);

  const fullSymbol = symbol;
  const isSellSignal = signal === "SELL";
  const side = isSellSignal ? "SELL" : "BUY";

  // No signal and no position — report and exit
  if (!signal && !symbol) {
    report({
      date: new Date(),
      trade: null,
      primarySymbol: null,
      price: null,
      priceChangePercent: 0,
    });
    console.info("No signal detected and no position open");
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
    return;
  }

  // No signal but there is a position — report HOLD
  if (!signal) {
    report({
      date: new Date(),
      trade: null,
      primarySymbol: symbol,
      price: price || null,
      priceChangePercent: priceChangePercent || 0,
    });
    console.info(`No trade signal, holding position on ${symbol}`);
    return;
  }

  // Calculate trade quantity
  const quantity = await calculateTradeQuantity(fullSymbol, price);
  const notional = quantity * price;

  // If quantity too small — report PASS and clear position
  if (quantity <= 0) {
    console.info(
      `Calculated quantity is 0 or too small for ${fullSymbol}, skipping trade.`
    );
    report({
      date: new Date(),
      trade: "PASS",
      primarySymbol: fullSymbol,
      price: price || null,
      priceChangePercent: priceChangePercent || 0,
    });
    // Clear position because trade failed
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
    return;
  }

  // Check balance
  const usdtBalance = await getFuturesAccountUSDTBalance();
  if (notional > usdtBalance) {
    console.info(
      `Trade skipped for ${signal} on ${fullSymbol}, not enough balance: ${usdtBalance.toFixed(2)} USDT`
    );
    report({
      date: new Date(),
      trade: "PASS",
      primarySymbol: fullSymbol,
      price: price || null,
      priceChangePercent: priceChangePercent || 0,
    });
    // Clear position because trade failed
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
    return;
  }

  // Try to place an order
  let order;
  try {
    order = await createMarketOrderFutures({
      symbol: fullSymbol,
      side,
      quantity,
    });
  } catch (err) {
    console.error(`Error creating ${side} order for ${fullSymbol}:`, err);
    report({
      date: new Date(),
      trade: "PASS",
      primarySymbol: fullSymbol,
      price: price || null,
      priceChangePercent: priceChangePercent || 0,
    });
    // Clear position because trade failed
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
    return;
  }

  console.info(
    `Trade executed for ${signal} on ${fullSymbol}, order response:`,
    order
  );

  // Get executed price
  const executedPrice = parseFloat(order.avgPrice || order.price || price);

  // Update position state after successful trade
  if (side === "SELL") {
    positionState = { symbol, stopLoss, takeProfit, shortPrice };
  } else if (side === "BUY") {
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
  }

  // Report trade
  report({
    date: new Date(),
    trade: side,
    primarySymbol: fullSymbol,
    price: executedPrice,
    priceChangePercent,
  });
}

async function closeAllClosablePositions() {
  console.info(">>> closeAllClosablePositions() started");

  try {
    const positions = await getFuturesPositionsFutures();
    console.info(`Got ${positions.length} positions from API`);

    const openPositions = positions.filter(
      (position) => parseFloat(position.positionAmt) !== 0
    );

    console.info(`Filtered to ${openPositions.length} open positions`);

    if (openPositions.length === 0) {
      console.info("No open positions");
      return;
    }

    console.info("Open positions:");
    for (const pos of openPositions) {
      const positionAmt = parseFloat(pos.positionAmt);
      const markPrice = parseFloat(pos.markPrice);
      const notional = Math.abs(positionAmt) * markPrice;

      console.info(
        `${pos.symbol}: amount ${pos.positionAmt}, entryPrice ${pos.entryPrice}, markPrice ${pos.markPrice}, unrealized PnL ${pos.unRealizedProfit}, notional ~${notional.toFixed(2)} USDT`
      );
    }

    for (const position of openPositions) {
      const positionAmt = parseFloat(position.positionAmt);
      const markPrice = parseFloat(position.markPrice);
      const notional = Math.abs(positionAmt) * markPrice;

      let stepSize, minQty, minNotional;

      try {
        ({ stepSize, minQty, minNotional } = await getSymbolMinTradeFutures(
          position.symbol
        ));
      } catch (err) {
        console.error(
          `Failed to get min trade info for ${position.symbol}:`,
          err
        );

        continue;
      }

      const closable =
        Math.abs(positionAmt) >= stepSize &&
        Math.abs(positionAmt) >= minQty &&
        notional >= (minNotional || 0);

      if (!closable) {
        console.info(
          `Position ${position.symbol} not closable: amount ${Math.abs(
            positionAmt
          )}, stepSize ${stepSize}, minQty ${minQty}, notional ${notional.toFixed(
            2
          )}, minNotional ${minNotional || 0}`
        );
        console.info(
          `Dust position on ${position.symbol}, amount: ${position.positionAmt}`
        );
        continue;
      }

      const closeSide = positionAmt > 0 ? "SELL" : "BUY";
      console.info(
        `Closing ${position.symbol} position, amount: ${Math.abs(positionAmt)}`
      );

      try {
        const result = await closeMarketOrderFutures({
          symbol: position.symbol,
          side: closeSide,
          quantity: Math.abs(positionAmt),
          positionSide: position.positionSide || "BOTH",
        });
        console.info(`${position.symbol} closed, response:`, result);
      } catch (error) {
        console.error(`Failed to close ${position.symbol}:`, error);
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

    // secondarySymbol должен быть определён глобально или передан в функцию
    console.log("Account balances:", balances);
    console.log("secondarySymbol:", secondarySymbol);

    if (!price || price <= 0) {
      console.warn(`Invalid price for ${symbol}:`, price);
      return 0;
    }

    const quoteBalance =
      balances.find((b) => b.symbol === secondarySymbol)?.available || 0;

    if (!quoteBalance || quoteBalance <= 0) {
      console.warn(`No available balance for ${secondarySymbol}`);
      return 0;
    }

    // Определяем quoteAmount в зависимости от useFixedTradeValue и tradeValue
    let quoteAmount;
    if (
      typeof useFixedTradeValue !== "boolean" ||
      typeof tradeValue !== "number"
    ) {
      console.warn("useFixedTradeValue or tradeValue not properly defined");
      return 0;
    }
    quoteAmount = useFixedTradeValue
      ? tradeValue
      : (quoteBalance * tradeValue) / 100;

    // Корректируем комиссию
    const availableForTrade = quoteAmount * (1 - commissionPercent / 100);

    if (availableForTrade <= 0) {
      console.warn(
        `availableForTrade is zero or negative: ${availableForTrade}`
      );
      return 0;
    }

    const { stepSize, minQty } = await getSymbolMinTradeFutures(symbol);

    if (!stepSize || !minQty) {
      console.warn(`Invalid stepSize or minQty for ${symbol}`, {
        stepSize,
        minQty,
      });
      return 0;
    }

    const rawQty = availableForTrade / price;

    if (isNaN(rawQty) || rawQty <= 0) {
      console.warn(`Invalid rawQty for ${symbol}:`, rawQty);
      return 0;
    }

    // Floor quantity to step size precision
    const precision = (stepSize.toString().split(".")[1] || []).length;
    const quantity = Math.floor(rawQty / stepSize) * stepSize;

    // Check minimum quantity limit
    if (quantity < minQty) {
      console.warn(
        `Quantity ${quantity} is less than minQty ${minQty} for ${symbol}, setting quantity=0`
      );
      return 0;
    }

    console.log({
      symbol,
      price,
      secondarySymbol,
      quoteBalance,
      quoteAmount,
      availableForTrade,
      rawQty,
      stepSize,
      minQty,
      quantity,
    });

    return parseFloat(quantity.toFixed(precision));
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
