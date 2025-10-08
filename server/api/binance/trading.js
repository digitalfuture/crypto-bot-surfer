// trending.js

import binance from "./connection.js";
import { delay } from "../../helpers/functions.js";
import { getExchangeInfo, getLastPrice, getSymbolBalance } from "./info.js";

const delayMs = JSON.parse(process.env.DELAY);
const isfixedValue = process.env.USE_FIXED_TRADE_VALUE;
const fixedValue = parseFloat(process.env.FIXED_TRADE_VALUE);
const fixedPercent = parseFloat(process.env.FIXED_TRADE_PERCENT);

// ✅ Вспомогательная функция для создания настоящих ошибок
function wrapError(type, originalError) {
  const message = originalError?.message || String(originalError) || 'Unknown error';
  const error = new Error(`${type}: ${message}`);
  error.type = type;
  error.originalError = originalError;
  return error;
}

export async function marketBuy({
  primarySymbol,
  secondarySymbol,
  tickerName,
  secondarySymbolBalance,
}) {
  try {
    console.info("Secondary symbol balance:", secondarySymbolBalance);

    if (isfixedValue && secondarySymbolBalance < fixedValue) {
      console.info("\n\nInsufficient balance");
      console.info(secondarySymbol, "balance must be >", fixedValue);
      return { result: false };
    } else if (
      secondarySymbolBalance < (secondarySymbolBalance / 100) * fixedPercent
    ) {
      console.info("\n\nInsufficient balance");
      console.info(
        secondarySymbol,
        "balance must be >",
        (secondarySymbolBalance / 100) * fixedPercent
      );
      // ⚠️ Возможно, здесь тоже нужно return { result: false }?
    }

    const { buyQuantity } = await getOrderQuantity({
      primarySymbol,
      secondarySymbol,
      tickerName,
    });

    if (buyQuantity === 0) {
      return { result: false };
    }

    await delay(delayMs);
    const response = await binance.marketBuy(tickerName, buyQuantity);

    return {
      quantity: parseFloat(response.executedQty),
      status: response.status,
      srcData: response,
      result: true,
    };
  } catch (error) {
    throw wrapError("Market Buy Error", error);
  }
}

export async function marketSell({
  primarySymbol,
  secondarySymbol,
  tickerName,
}) {
  try {
    const { sellQuantity } = await getOrderQuantity({
      primarySymbol,
      secondarySymbol,
      tickerName,
    });

    if (sellQuantity === 0) {
      return { result: false };
    }

    await delay(delayMs);
    const response = await binance.marketSell(tickerName, sellQuantity);

    return {
      quantity: parseFloat(response.executedQty),
      status: response.status,
      srcData: response,
      result: true,
    };
  } catch (error) {
    throw wrapError("Market Sell Error", error);
  }
}

export async function getOrderQuantity({
  primarySymbol,
  secondarySymbol,
  tickerName,
}) {
  try {
    await delay(delayMs);

    const primarySymbolBalance = await getSymbolBalance(primarySymbol);
    const secondarySymbolBalance = await getSymbolBalance(secondarySymbol);
    const { minOrderQuantity, minOrderValue, stepSize } =
      await getExchangeInfo(tickerName);

    const price = await getLastPrice(tickerName);
    console.info("price:", price);

    let buyQuantity;
    if (isfixedValue) {
      console.info("\nFixed Volume:", fixedValue);
      buyQuantity = await binance.roundStep(
        fixedValue / price - parseFloat(stepSize),
        stepSize
      );
    } else {
      console.info("\nFixed Percent:", fixedPercent);
      buyQuantity = await binance.roundStep(
        (secondarySymbolBalance / price / 100) * fixedPercent,
        stepSize
      );
    }

    console.info("buyQuantity:", buyQuantity);

    const insufficientBalanceToBuy =
      buyQuantity < minOrderQuantity || buyQuantity * price < minOrderValue;

    if (insufficientBalanceToBuy) {
      buyQuantity = 0;
    }

    let sellQuantity = await binance.roundStep(primarySymbolBalance, stepSize);
    const insufficientBalanceToSell =
      sellQuantity < minOrderQuantity || sellQuantity * price < minOrderValue;

    if (insufficientBalanceToSell) {
      sellQuantity = 0;
    }

    console.info("primarySymbolBalance:", primarySymbolBalance);
    console.info("secondarySymbolBalance:", secondarySymbolBalance);
    console.info("minOrderQuantity:", minOrderQuantity);
    console.info("minOrderValue:", minOrderValue);
    console.info("sellQuantity:", sellQuantity);
    console.info("buyQuantity:", buyQuantity);
    console.info("stepSize:", stepSize);

    return { sellQuantity, buyQuantity };
  } catch (error) {
    throw wrapError("Get Order Quantity Error", error);
  }
}

// === FUTURES ===

export async function createMarketOrderFutures({ symbol, side, quantity }) {
  try {
    await delay(delayMs);

    // Set leverage = 1
    try {
      await binance.futuresLeverage(symbol, 1);
      console.log(`Leverage set to 1 for ${symbol}`);
    } catch (error) {
      console.warn(
        `Failed to set leverage for ${symbol}:`,
        error.body || error.message
      );
    }

    const orderResponse = await binance.futuresOrder(
      "MARKET",
      side,
      symbol,
      quantity,
      undefined,
      { newOrderRespType: "RESULT" }
    );

    const fill = orderResponse?.avgFillPrice || orderResponse?.price || 0;
    const commission = orderResponse?.cumQuote || 0;

    return {
      symbol,
      side,
      price: 0,
      avgFillPrice: parseFloat(fill),
      quantity: parseFloat(quantity),
      commission: parseFloat(commission),
      orderId: orderResponse.orderId,
      status: orderResponse.status,
      rawResponse: orderResponse,
    };
  } catch (error) {
    throw wrapError("Create Futures Market Order Error", error);
  }
}

export async function closeMarketOrderFutures({
  symbol,
  side,
  quantity,
  positionSide,
}) {
  try {
    console.info(
      `Closing full position for symbol=${symbol}, side=${side}, quantity=${quantity}, positionSide=${positionSide}`
    );

    const options = { reduceOnly: true };
    if (positionSide && positionSide !== "BOTH") {
      options.positionSide = positionSide;
    }

    const response = await binance.futuresOrder(
      "MARKET",
      side,
      symbol,
      quantity,
      undefined,
      options
    );

    return response;
  } catch (error) {
    console.error(`Error closing position for ${symbol}:`, error);
    throw wrapError("Close Futures Order", error);
  }
}