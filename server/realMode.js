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
const tradeValue = parseFloat(process.env.TRADE_VALUE || "0");
const commissionReserve = 0.002;

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

  // Update position state before making any trade attempts
  if (signal === "SELL") {
    positionState = { symbol, stopLoss, takeProfit, shortPrice };
  } else if (signal === "BUY") {
    positionState = {
      symbol: null,
      stopLoss: null,
      takeProfit: null,
      shortPrice: null,
    };
  } else {
    positionState = { symbol, stopLoss, takeProfit, shortPrice };
  }

  // If there is no signal and no open position, report as HOLD
  if (!signal && !symbol) {
    report({
      date: new Date(),
      trade: null,
      primarySymbol: null,
      price: null,
      priceChangePercent: 0,
    });
    console.info("No signal detected and no position open");
    return;
  }

  // If no trade signal but a symbol exists, report HOLD for that symbol
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

  const fullSymbol = symbol;
  const isSellSignal = signal === "SELL";
  const side = isSellSignal ? "SELL" : "BUY";

  // Calculate the trade quantity
  const quantity = await calculateTradeQuantity(fullSymbol, price);
  const notional = quantity * price;

  // If quantity is too small, report PASS
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
    return;
  }

  console.info(
    `Signal: ${signal} ${fullSymbol} at price ${price}, suggested quantity ${quantity} (~${notional.toFixed(2)} USDT)`
  );

  // Check available balance
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
    return;
  }

  // Try to place a market order
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
    return;
  }

  console.info(
    `Trade executed for ${signal} on ${fullSymbol}, order response:`,
    order
  );

  // Get executed price from order response or use original price
  const executedPrice = parseFloat(order.avgPrice || order.price || price);

  // Report the successful trade
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
  const price = lastPrice || (await getLastPriceFutures(symbol));
  const balances = await getAccountBalancesFutures();

  // Make sure secondarySymbol is set correctly — for example 'USDT'
  const quoteBalance =
    balances.find((b) => b.symbol === secondarySymbol)?.available || 0;

  let quoteAmount = useFixedTradeValue
    ? tradeValue
    : (quoteBalance * tradeValue) / 100;

  const availableForTrade = quoteAmount * (1 - commissionReserve);

  const { stepSize, minQty } = await getSymbolMinTradeFutures(symbol);
  const rawQty = availableForTrade / price;

  // Floor quantity to step size
  const quantity = Math.floor(rawQty / stepSize) * stepSize;

  // Log all relevant data for debugging
  console.log({
    symbol,
    price,
    quoteBalance,
    quoteAmount,
    availableForTrade,
    rawQty,
    stepSize,
    minQty,
    quantity,
  });

  return parseFloat(quantity.toFixed(8));
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
