// trending.js

import binance from "./connection.js";
import { delay } from "../../helpers/functions.js";

import { getExchangeInfo, getLastPrice, getSymbolBalance } from "./info.js";

const delayMs = JSON.parse(process.env.DELAY);
const isfixedValue = process.env.USE_FIXED_TRADE_VALUE;
const fixedValue = parseFloat(process.env.FIXED_TRADE_VALUE);
const fixedPercent = parseFloat(process.env.FIXED_TRADE_PERCENT);

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
      secondarySymbolBalance <
      (secondarySymbolBalance / 100) * fixedPercent
    ) {
      console.info("\n\nInsufficient balance");
      console.info(
        secondarySymbol,
        "balance must be >",
        (secondarySymbolBalance / 100) * fixedPercent
      );
    }

    const { buyQuantity } = await getOrderQuantity({
      primarySymbol,
      secondarySymbol,
      tickerName,
    });

    // console.info("buyQuantity:", buyQuantity);

    if (buyQuantity === 0) {
      return { result: false };
    }

    await delay(delayMs);
    const response = await binance.marketBuy(tickerName, buyQuantity);

    // console.info(response);

    return {
      quantity: parseFloat(response.executedQty),
      status: response.status,
      srcData: response,
      result: true,
    };
  } catch (error) {
    throw { type: "Market Buy Error", ...error, errorSrcData: error };
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

    // console.info(response);

    return {
      quantity: response.executedQty,
      status: response.status,
      srcData: response,
      result: true,
    };
  } catch (error) {
    throw { type: "Market Sell Error", ...error, errorSrcData: error };
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

    // Buy quantity
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

    console.info("insufficientBalanceToBuy:", insufficientBalanceToBuy);

    if (insufficientBalanceToBuy) {
      buyQuantity = 0;
    }

    // Sell quantity
    let sellQuantity = await binance.roundStep(primarySymbolBalance, stepSize);

    // console.info("sellQuantity berore check", sellQuantity);

    const insufficientBalanceToSell =
      sellQuantity < minOrderQuantity || sellQuantity * price < minOrderValue;

    console.info("insufficientBalanceToSell:", insufficientBalanceToSell);

    if (insufficientBalanceToSell) {
      sellQuantity = 0;
    }

    // console.info('\n')
    console.info("primarySymbolBalance:", primarySymbolBalance);
    console.info("secondarySymbolBalance:", secondarySymbolBalance);
    console.info("minOrderQuantity:", minOrderQuantity);
    console.info("minOrderValue:", minOrderValue);
    console.info("sellQuantity:", sellQuantity);
    console.info("buyQuantity:", buyQuantity);
    console.info("stepSize:", stepSize);

    return { sellQuantity, buyQuantity: buyQuantity };
  } catch (error) {
    throw { type: "Get Order Quantity Error", ...error, errorSrcData: error };
  }
}

// Futures
export async function createMarketOrderFutures({ symbol, side, quantity }) {
  try {
    await delay(delayMs);

    // Set leverage = 1 for this symbol before placing order
    try {
      await binance.futuresLeverage(symbol, 1);
      console.log(`Leverage set to 1 for ${symbol}`);
    } catch (error) {
      console.warn(
        `Failed to set leverage for ${symbol}:`,
        error.body || error.message
      );
      // Не прерываем выполнение, просто логируем
    }

    const orderResponse = await binance.futuresOrder(
      "MARKET", // type
      side, // side ("BUY" или "SELL")
      symbol, // symbol
      quantity, // quantity
      undefined, // price
      {
        newOrderRespType: "RESULT",
      }
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
    throw {
      type: "Create Futures Market Order Error",
      ...error,
      errorSrcData: error,
    };
  }
}

export async function closeMarketOrderFutures({
  symbol,
  side,
  positionSide,
  quantity,
}) {
  try {
    console.info(
      `Closing market order: symbol=${symbol}, side=${side}, positionSide=${positionSide}, quantity=${quantity}`
    );

    let options = {};

    if (positionSide && positionSide !== "BOTH") {
      // Hedge mode - передаем reduceOnly и closePosition, quantity НЕ нужен
      options = {
        reduceOnly: true,
        closePosition: true,
        positionSide,
      };

      // quantity можно не передавать, т.к. closePosition=true
      return await binance.futuresOrder(
        "MARKET",
        side,
        symbol,
        undefined,
        undefined,
        options
      );
    } else {
      // One-way mode - нужно обязательно передать quantity, НЕ передаем reduceOnly и closePosition
      if (!quantity || quantity <= 0) {
        throw new Error(
          "Quantity must be specified and greater than zero for closing order in One-way mode"
        );
      }

      return await binance.futuresOrder(
        "MARKET",
        side,
        symbol,
        quantity,
        undefined,
        options
      );
    }
  } catch (error) {
    console.error(`Error closing position for ${symbol}:`, error);
    throw { type: "Close Futures Order", ...error, errorSrcData: error };
  }
}
