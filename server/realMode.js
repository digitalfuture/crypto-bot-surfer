import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getSignals } from "./analytics/indicators/index.js";
import {
  getAccountBalancesFutures,
  getFuturesPositionsFutures,
  getSymbolMinTradeFutures,
  getLastPrice,
} from "./api/binance/info.js";
import {
  createMarketOrderFutures,
  closeMarketOrderFutures,
} from "./api/binance/trading.js";
import util from "node:util";

const onlyCleanBalance = process.env.ONLY_CLEAN_BALANCE === "true";
const secondarySymbol = process.env.SECONDARY_SYMBOL;
const appMode = process.env.MODE;
const interval = process.env.HEARTBEAT_INTERVAL;
const heartbeatInterval = getHeartbeatInterval(interval);

const useFixedTradeValue = process.env.USE_FIXED_TRADE_VALUE === "true";
const tradeValue = parseFloat(process.env.TRADE_VALUE || "0");
const commissionReserve = 0.002;

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

    await closeAllClosablePositions();

    if (onlyCleanBalance) {
      console.info(
        "ONLY_CLEAN_BALANCE is true. Stopping bot after clearing balance."
      );
      console.info("Bot stopped.");
      break;
    }

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
  const { symbol, price, signal } = await getSignals();
  if (!symbol || !signal) {
    console.info("No signal detected");
    return;
  }

  const fullSymbol = symbol;
  const isSellSignal = signal === "SELL";

  const quantity = await calculateTradeQuantity(fullSymbol, price);

  console.info(
    `Signal detected: ${signal} ${fullSymbol} at price ${price}, suggested quantity ${quantity}`
  );

  await createMarketOrderFutures({
    symbol: fullSymbol,
    side: isSellSignal ? "SELL" : "BUY",
    quantity,
    type: "MARKET",
  });

  console.info(`Trade skipped for ${signal} on ${fullSymbol}`);
}

async function closeAllClosablePositions() {
  const positions = await getFuturesPositionsFutures();

  const openPositions = positions.filter(
    (position) => parseFloat(position.positionAmt) !== 0
  );

  if (openPositions.length === 0) {
    console.info("No open positions");
    return;
  }

  console.info("Open positions:");
  for (const pos of openPositions) {
    console.info(
      `${pos.symbol}: amount ${pos.positionAmt}, entryPrice ${pos.entryPrice}, markPrice ${pos.markPrice}, unrealized PnL ${pos.unRealizedProfit}`
    );
  }

  for (const position of openPositions) {
    const positionAmt = parseFloat(position.positionAmt);

    const closable = await isPositionClosable(position);
    if (!closable) {
      console.info(
        `Dust position on ${position.symbol}, amount: ${positionAmt}`
      );
      continue;
    }

    const closeSide = positionAmt > 0 ? "SELL" : "BUY";
    console.info(
      `Closing ${position.symbol} position, amount: ${Math.abs(positionAmt)}`
    );

    await closeMarketOrderFutures({
      symbol: position.symbol,
      side: closeSide,
      quantity: Math.abs(positionAmt),
    });

    console.info(`${position.symbol} closed`);
  }
}

async function isPositionClosable(position) {
  const { stepSize, minQty, minNotional } = await getSymbolMinTradeFutures(
    position.symbol
  );
  const positionAmt = Math.abs(parseFloat(position.positionAmt));
  const markPrice = parseFloat(position.markPrice);
  const notional = positionAmt * markPrice;

  return (
    positionAmt >= stepSize && positionAmt >= minQty && notional >= minNotional
  );
}

async function calculateTradeQuantity(symbol, lastPrice) {
  let price = lastPrice || (await getLastPrice(symbol));

  const balances = await getAccountBalancesFutures();
  const quoteBalance =
    balances.find((b) => b.symbol === secondarySymbol)?.available || 0;

  let quoteAmount = useFixedTradeValue
    ? tradeValue
    : (quoteBalance * tradeValue) / 100;
  const availableForTrade = quoteAmount * (1 - commissionReserve);

  return parseFloat((availableForTrade / price).toFixed(8));
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
