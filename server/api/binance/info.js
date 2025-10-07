// info.js

import binance from "./connection.js";
import { delay } from "../../helpers/functions.js";

const delayMs = JSON.parse(process.env.DELAY);

function wrapError(type, originalError) {
  const message = originalError?.message || String(originalError) || 'Unknown error';
  const error = new Error(`${type}: ${message}`);
  error.type = type;
  error.originalError = originalError; // сохраняем оригинал для отладки
  return error;
}

// Теперь все функции используют wrapError

export async function getExchangeInfo(symbol) {
  try {
    await delay(delayMs);
    const data = await binance.exchangeInfo();
    
    const tickerInfo = data.symbols.find((ticker) => ticker.symbol === symbol);
    const limits = {};

    for (let obj of data.symbols) {
      let filters = { status: obj.status };
      for (let filter of obj.filters) {
        if (filter.filterType == "MIN_NOTIONAL") {
          filters.minNotional = filter.minNotional;
        } else if (filter.filterType == "PRICE_FILTER") {
          filters.minPrice = filter.minPrice;
          filters.maxPrice = filter.maxPrice;
          filters.tickSize = filter.tickSize;
        } else if (filter.filterType == "LOT_SIZE") {
          filters.stepSize = filter.stepSize;
          filters.minQty = filter.minQty;
          filters.maxQty = filter.maxQty;
        }
      }
      filters.orderTypes = obj.orderTypes;
      filters.icebergAllowed = obj.icebergAllowed;
      limits[obj.symbol] = filters;
    }

    const tickerLimits = limits[symbol];
    const minOrderQuantity = parseFloat(tickerLimits.minQty);
    const minOrderValue = parseFloat(tickerLimits.minNotional);
    const stepSize = tickerLimits.stepSize;

    console.info("\ntickerLimits:", tickerLimits);

    return {
      minOrderQuantity,
      minOrderValue,
      stepSize,
      tickerInfo,
    };
  } catch (error) {
    throw wrapError("Get Exchange Info", error);
  }
}

export async function getTradingTickers() {
  try {
    await delay(delayMs);
    const data = await binance.exchangeInfo();
    const tickerList = data.symbols
      .filter((ticker) => ticker.status === "TRADING")
      .filter((ticker) => ticker.isSpotTradingAllowed)
      .map((ticker) => ticker.symbol);
    return tickerList;
  } catch (error) {
    throw wrapError("Get Trading Tickers", error);
  }
}

export async function getLastPrice(symbol) {
  try {
    await delay(delayMs);
    const priceList = await binance.prices();
    const tickerPrice = parseFloat(priceList[symbol]);
    return tickerPrice;
  } catch (error) {
    throw wrapError("Get Last Price", error);
  }
}

export async function getPrevDayData(symbol) {
  try {
    await delay(delayMs);
    if (symbol) {
      const data = await binance.prevDay(symbol);
      return [data];
    } else {
      const data = await binance.prevDay(false);
      return data;
    }
  } catch (error) {
    throw wrapError("Get Prev Day Data", error);
  }
}

export async function getSymbolBalance(symbolName) {
  try {
    await delay(delayMs);
    const balances = await binance.balance();
    return parseFloat(balances[symbolName] ? balances[symbolName].available : 0);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Symbol Balance Error", error);
  }
}

export async function getTradingHistory(symbol) {
  try {
    await delay(delayMs);
    return await binance.trades(symbol);
  } catch (error) {
    throw wrapError("Get Trading History Error", error);
  }
}

export async function getCandlestickData({ symbol, interval, periods, endTime = Date.now() }) {
  try {
    await delay(delayMs);
    const candlesticks = await binance.candlesticks(symbol, interval, {
      limit: periods,
      endTime,
    });
    return candlesticks.map(({ openTime, open, high, low, close, volume }) => [
      openTime,
      parseFloat(open),
      parseFloat(high),
      parseFloat(low),
      parseFloat(close),
      parseFloat(volume),
    ]);
  } catch (error) {
    throw wrapError("Get Candlestick Data Error", error);
  }
}

export async function getAccountBalances() {
  try {
    await delay(delayMs);
    const balances = await binance.balance();
    return Object.entries(balances).map(([symbol, data]) => ({
      symbol,
      available: parseFloat(data.available),
    }));
  } catch (error) {
    throw wrapError("Get Account Balances Error", error);
  }
}

// === FUTURES ===

export async function getFuturesList() {
  try {
    const exchangeInfo = await binance.futuresExchangeInfo();
    return exchangeInfo.symbols
      .filter(({ contractType }) => contractType === "PERPETUAL")
      .filter(({ status }) => status === "TRADING");
  } catch (error) {
    throw wrapError("Get Futures List Data", error);
  }
}

export async function getPrevDayDataFutures(symbol) {
  try {
    await delay(delayMs);
    if (symbol) {
      const data = await binance.futuresPrevDay(symbol);
      return [data];
    } else {
      const data = await binance.futuresPrevDay(false);
      return data;
    }
  } catch (error) {
    throw wrapError("Get Prev Day Data Futures", error);
  }
}

export async function getExchangeInfoFutures(symbol) {
  try {
    await delay(delayMs);
    const data = await binance.futuresExchangeInfo();
    const limits = {};

    for (const obj of data.symbols) {
      let filters = { status: obj.status };
      for (const filter of obj.filters) {
        if (filter.filterType === "MIN_NOTIONAL") {
          filters.minNotional = filter.minNotional;
        } else if (filter.filterType === "PRICE_FILTER") {
          filters.minPrice = filter.minPrice;
          filters.maxPrice = filter.maxPrice;
          filters.tickSize = filter.tickSize;
        } else if (filter.filterType === "LOT_SIZE") {
          filters.stepSize = filter.stepSize;
          filters.minQty = filter.minQty;
          filters.maxQty = filter.maxQty;
        }
      }
      filters.orderTypes = obj.orderTypes;
      filters.icebergAllowed = obj.icebergAllowed;
      limits[obj.symbol] = filters;
    }

    const tickerLimits = limits[symbol];
    if (!tickerLimits) {
      throw new Error(`Symbol limits not found for ${symbol}`);
    }

    return {
      minOrderQuantity: parseFloat(tickerLimits.minQty),
      minOrderValue: parseFloat(tickerLimits.minNotional),
      stepSize: parseFloat(tickerLimits.stepSize),
      tickerInfo: data.symbols.find((ticker) => ticker.symbol === symbol),
    };
  } catch (error) {
    throw wrapError("Get Exchange Info Futures", error);
  }
}

let cachedExchangeInfo = null;

async function getExchangeInfoCached() {
  if (!cachedExchangeInfo) {
    cachedExchangeInfo = await binance.futuresExchangeInfo();
  }
  return cachedExchangeInfo;
}

export async function getSymbolMinTradeFutures(symbol) {
  try {
    const exchangeInfo = await getExchangeInfoCached();
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const marketLotSizeFilter = symbolInfo.filters.find(f => f.filterType === "MARKET_LOT_SIZE");
    const notionalFilter = symbolInfo.filters.find(f => f.filterType === "NOTIONAL");

    if (!lotSizeFilter && !marketLotSizeFilter) {
      throw new Error(`No LOT_SIZE or MARKET_LOT_SIZE filter found for ${symbol}`);
    }

    return {
      stepSize: parseFloat(marketLotSizeFilter?.stepSize || lotSizeFilter.stepSize),
      minQty: parseFloat(marketLotSizeFilter?.minQty || lotSizeFilter.minQty),
      minNotional: notionalFilter ? parseFloat(notionalFilter.minNotional ?? notionalFilter.notional) : 0,
    };
  } catch (error) {
    throw wrapError("Get Symbol Min Trade Futures Error", error);
  }
}

export async function getFuturesPositionsFutures() {
  try {
    return await binance.futuresPositionRisk();
  } catch (error) {
    throw wrapError("Get Positions Futures Error", error);
  }
}

export async function getCandlestickDataFutures({ symbol, interval, periods, endTime = Date.now() }) {
  try {
    await delay(delayMs);
    const candlesticks = await binance.futuresCandlesticks(symbol, interval, {
      limit: periods,
      endTime,
    });
    return candlesticks.map(({ openTime, open, high, low, close, volume }) => [
      openTime,
      parseFloat(open),
      parseFloat(high),
      parseFloat(low),
      parseFloat(close),
      parseFloat(volume),
    ]);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Candlestick Data Futures Error", error);
  }
}

export async function getTradingTickersFutures() {
  try {
    await delay(delayMs);
    const data = await binance.futuresExchangeInfo();
    return data.symbols
      .filter(ticker => ticker.status === "TRADING")
      .map(ticker => ticker.symbol);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Trading Tickers Futures Error", error);
  }
}

export async function getLastPriceFutures(symbol) {
  try {
    await delay(delayMs);
    const priceList = await binance.futuresPrices();
    return parseFloat(priceList[symbol]);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Last Price Futures Error", error);
  }
}

export async function getFuturesAccountUSDTBalance() {
  try {
    const accountInfo = await binance.futuresAccount();
    const walletBalance = parseFloat(accountInfo.totalWalletBalance || 0);
    const unrealizedProfit = parseFloat(accountInfo.totalUnrealizedProfit || 0);
    return {
      walletBalance,
      unrealizedProfit,
      totalBalance: walletBalance + unrealizedProfit,
    };
  } catch (error) {
    throw wrapError("Get USDT Futures Balance Error", error);
  }
}

export async function getAccountBalancesFutures() {
  try {
    await delay(delayMs);
    const accountInfo = await binance.futuresAccount();
    return accountInfo.assets
      .map(({ asset, availableBalance }) => ({
        symbol: asset,
        available: parseFloat(availableBalance),
      }))
      .filter(({ available }) => available > 0);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Account Balance Futures Error", error);
  }
}

export async function getSymbolBalanceFutures(symbolName) {
  try {
    await delay(delayMs);
    const balances = await binance.futuresBalance();
    return parseFloat(balances[symbolName] ? balances[symbolName].available : 0);
  } catch (error) {
    console.info("error:", error);
    throw wrapError("Get Symbol Balance Futures Error", error);
  }
}