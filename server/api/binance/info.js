// info.js

import binance from "./connection.js";
import { delay } from "../../helpers/functions.js";

const delayMs = JSON.parse(process.env.DELAY);

export async function getExchangeInfo(symbol) {
  try {
    await delay(delayMs);

    const data = await binance.exchangeInfo();
    // console.info("\nExchangeInfo:", data);

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

      //filters.baseAssetPrecision = obj.baseAssetPrecision;
      //filters.quoteAssetPrecision = obj.quoteAssetPrecision;
      filters.orderTypes = obj.orderTypes;
      filters.icebergAllowed = obj.icebergAllowed;
      limits[obj.symbol] = filters;
    }

    const tickerLimits = limits[symbol];
    const minOrderQuantity = parseFloat(tickerLimits.minQty);
    const minOrderValue = parseFloat(tickerLimits.minNotional);
    const stepSize = tickerLimits.stepSize;

    console.info("\n");
    console.info("tickerLimits:", tickerLimits);

    return {
      minOrderQuantity,
      minOrderValue,
      stepSize,
      tickerInfo,
    };
  } catch (error) {
    throw { type: "Get Exchange Info", ...error, errorSrcData: error };
  }
}

export async function getTradingTickers() {
  try {
    await delay(delayMs);

    const data = await binance.exchangeInfo();
    // console.info("\n");
    // console.info("Exchange info:", data);

    const tickerList = data.symbols
      .filter((ticker) => ticker.status === "TRADING")
      .filter((ticker) => ticker.isSpotTradingAllowed)
      .map((ticker) => ticker.symbol);

    // console.log("tickerList.", tickerList);

    return tickerList;
  } catch (error) {
    throw { type: "Get Exchange Info", ...error, errorSrcData: error };
  }
}

export async function getLastPrice(symbol) {
  try {
    await delay(delayMs);

    const priceList = await binance.prices();
    const tickerPrice = parseFloat(priceList[symbol]);

    return tickerPrice;
  } catch (error) {
    throw { type: "Get Last Price", ...error, errorSrcData: error };
  }
}

export async function getPrevDayData(symbol) {
  // prevDayData
  //
  // [{
  //   "symbol": "ETHBTC",
  //   "priceChange": "0.00018800",
  //   "priceChangePercent": "0.295",
  //   "weightedAvgPrice": "0.06373885",
  //   "prevClosePrice": "0.06371900",
  //   "lastPrice": "0.06390700",
  //   "lastQty": "0.03950000",
  //   "bidPrice": "0.06390200",
  //   "bidQty": "1.92630000",
  //   "askPrice": "0.06390300",
  //   "askQty": "7.50000000",
  //   "openPrice": "0.06371900",
  //   "highPrice": "0.06452400",
  //   "lowPrice": "0.06262600",
  //   "volume": "99264.72340000",
  //   "quoteVolume": "6327.01966104",
  //   "openTime": 1634376118872,
  //   "closeTime": 1634462518872,
  //   "firstId": 302652048,
  //   "lastId": 302837936,
  //   "count": 185889
  // },
  // ...
  // ],

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
    throw { type: "Get Prev Day Data", ...error, errorSrcData: error };
  }
}

export async function getSymbolBalance(symbolName) {
  try {
    await delay(delayMs);

    const balances = await binance.balance();

    return parseFloat(
      balances[symbolName] ? balances[symbolName].available : 0
    );
  } catch (error) {
    console.info("error:", error);
    throw { type: "Get Symbol Balance Error", ...error, errorSrcData: error };
  }
}

export async function getTradingHistory(symbol) {
  try {
    await delay(delayMs);

    return await binance.trades(symbol);
  } catch (error) {
    throw { type: "Get Trading History Error", ...error, errorSrcData: error };
  }
}

export async function getCandlestickData({
  symbol,
  interval,
  periods,
  endTime = Date.now(),
}) {
  try {
    await delay(delayMs);

    const candlesticks = await binance.candlesticks(symbol, interval, {
      limit: periods,
      endTime,
    });

    const result = candlesticks.map(
      ({ openTime, open, high, low, close, volume }) => {
        return [
          openTime,
          parseFloat(open),
          parseFloat(high),
          parseFloat(low),
          parseFloat(close),
          parseFloat(volume),
        ];
      }
    );

    // const lastTick = candlesticks[candlesticks.length - 1]
    // const [time, open, high, low, close, volume] = lastTick

    // console.info(
    //   `${symbol} OHLCV data loaded for last ${periods} ${interval} intervals`
    // )
    // console.info(`Time: ${new Date(time).toString()}`)
    // console.info(`Open: ${open}`)
    // console.info(`High: ${high}`)
    // console.info(`Low: ${low}`)
    // console.info(`Close: ${close}`)
    // console.info(`Volume: ${volume}`)

    return result;
  } catch (error) {
    throw { type: "Get Candlestick Data Error", ...error, errorSrcData: error };
  }
}

export async function getAccountBalances() {
  try {
    await delay(delayMs);

    const balances = await binance.balance();

    // console.info(balances);

    const result = [];

    for (const symbol in balances) {
      result.push({
        symbol,
        available: parseFloat(balances[symbol].available),
      });
    }

    return result;
  } catch (error) {
    throw { type: "Get Account Balances Error", ...error, errorSrcData: error };
  }
}

// Futures
export async function getFuturesList() {
  try {
    const exchangeInfo = await binance.futuresExchangeInfo();
    const futures = exchangeInfo.symbols
      .filter(({ contractType }) => contractType === "PERPETUAL")
      .filter(({ status }) => status === "TRADING");

    return futures;
  } catch (error) {
    throw { type: "Get Futures List Data", ...error, errorSrcData: error };
  }
}

export async function getPrevDayDataFutures(symbol) {
  // [
  //   {
  //     symbol: "BTCUSDT",
  //     priceChange: "-94.99999800",
  //     priceChangePercent: "-95.960",
  //     weightedAvgPrice: "0.29628482",
  //     lastPrice: "4.00000200",
  //     lastQty: "200.00000000",
  //     openPrice: "99.00000000",
  //     highPrice: "100.00000000",
  //     lowPrice: "0.10000000",
  //     volume: "8913.30000000",
  //     quoteVolume: "15.30000000",
  //     openTime: 1499783499040,
  //     closeTime: 1499869899040,
  //     firstId: 28385, // First tradeId
  //     lastId: 28460, // Last tradeId
  //     count: 76, // Trade count
  //   }
  // ];

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
    throw { type: "Get Prev Day Data", ...error, errorSrcData: error };
  }
}

export async function getExchangeInfoFutures(symbol) {
  // [
  //   {
  //       "symbol": "BTCUSDT",
  //       "price": "6000.01",
  //       "time": 1589437530011
  //   }
  // ]

  try {
    // Delay to avoid hitting API rate limits
    await delay(delayMs);

    // Fetch futures exchange info from Binance API
    const data = await binance.futuresExchangeInfo();

    const limits = {};

    // Parse filters for each symbol in the exchange info
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

    // Parse necessary parameters as floats
    const minOrderQuantity = parseFloat(tickerLimits.minQty);
    const minOrderValue = parseFloat(tickerLimits.minNotional);
    const stepSize = parseFloat(tickerLimits.stepSize);

    // Find ticker info for additional metadata
    const tickerInfo = data.symbols.find((ticker) => ticker.symbol === symbol);

    return {
      minOrderQuantity,
      minOrderValue,
      stepSize,
      tickerInfo,
    };
  } catch (error) {
    throw { type: "Get Exchange Info", ...error, errorSrcData: error };
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
    if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);

    const lotSizeFilter = symbolInfo.filters.find(
      (f) => f.filterType === "LOT_SIZE"
    );
    const marketLotSizeFilter = symbolInfo.filters.find(
      (f) => f.filterType === "MARKET_LOT_SIZE"
    );
    const notionalFilter = symbolInfo.filters.find(
      (f) => f.filterType === "NOTIONAL"
    );

    const stepSize = parseFloat(
      lotSizeFilter?.stepSize || marketLotSizeFilter?.stepSize || "1"
    );
    const minQty = parseFloat(
      marketLotSizeFilter?.minQty || lotSizeFilter?.minQty || "1"
    );
    const minNotional = parseFloat(
      notionalFilter?.notional || notionalFilter?.minNotional || "5"
    );

    return {
      stepSize,
      minQty,
      minNotional,
    };
  } catch (error) {
    console.error(`Error in getSymbolMinTradeFutures(${symbol}):`, error);
    throw {
      type: "Get Symbol Min Trade Futures",
      ...error,
      errorSrcData: error,
    };
  }
}

export async function getFuturesPositionsFutures() {
  //  [
  //    {
  //      "symbol": "BTCUSDT",
  //      "positionAmt": "0.001",
  //      "entryPrice": "25000.00",
  //      "markPrice": "26000.00",
  //      "unRealizedProfit": "1.00",
  //      "liquidationPrice": "20000.00",
  //      "leverage": "10",
  //      "marginType": "isolated",
  //      "isolatedMargin": "5.00",
  //      "positionSide": "BOTH",
  //      "updateTime": 1234567890123
  //    },
  //    {
  //      "symbol": "ETHUSDT",
  //      "positionAmt": "-0.5",
  //      "entryPrice": "1800.00",
  //      "markPrice": "1700.00",
  //      "unRealizedProfit": "-50.00",
  //      "liquidationPrice": "2000.00",
  //      "leverage": "5",
  //      "marginType": "cross",
  //      "isolatedMargin": "0.00",
  //      "positionSide": "BOTH",
  //      "updateTime": 1234567890123
  //    }
  //  ]

  try {
    // Request open futures positions for the account
    const data = await binance.futuresPositionRisk();

    // Return the raw data directly
    return data;
  } catch (error) {
    throw {
      type: "Get Futures Positions Futures",
      ...error,
      errorSrcData: error,
    };
  }
}

export async function getCandlestickDataFutures({
  symbol,
  interval,
  periods,
  endTime = Date.now(),
}) {
  try {
    await delay(delayMs);

    console.log(
      "Fetching candlestick data for:",
      symbol,
      interval,
      periods,
      endTime
    );

    const candlesticks = await binance.futuresCandlesticks(symbol, interval, {
      limit: periods,
      endTime,
    });

    const result = candlesticks.map(
      ({ openTime, open, high, low, close, volume }) => {
        return [
          openTime,
          parseFloat(open),
          parseFloat(high),
          parseFloat(low),
          parseFloat(close),
          parseFloat(volume),
        ];
      }
    );

    return result;
  } catch (error) {
    throw {
      type: "Get Candlestick Data Futures",
      ...error,
      errorSrcData: error,
    };
  }
}

export async function getTradingTickersFutures() {
  try {
    await delay(delayMs);

    const data = await binance.futuresExchangeInfo();

    const tickerList = data.symbols
      .filter((ticker) => ticker.status === "TRADING")
      .map((ticker) => ticker.symbol);

    return tickerList;
  } catch (error) {
    throw { type: "Get Exchange Info Futures", ...error, errorSrcData: error };
  }
}

export async function getLastPriceFutures(symbol) {
  try {
    await delay(delayMs);

    const priceList = await binance.futuresPrices();
    const tickerPrice = parseFloat(priceList[symbol]);

    return tickerPrice;
  } catch (error) {
    throw { type: "Get Last Price", ...error, errorSrcData: error };
  }
}

export async function getFuturesAccountUSDTBalance() {
  try {
    const accountInfo = await binance.futuresAccount();

    const walletBalance = parseFloat(accountInfo.totalWalletBalance || 0);
    const unrealizedProfit = parseFloat(accountInfo.totalUnrealizedProfit || 0);

    const totalBalance = walletBalance + unrealizedProfit;

    return {
      walletBalance,
      unrealizedProfit,
      totalBalance,
    };
  } catch (error) {
    throw {
      type: "Get Total Futures Balance",
      ...error,
      errorSrcData: error,
    };
  }
}

export async function getAccountBalancesFutures() {
  // Example response:
  // [
  //   { symbol: 'USDT', available: 99.3547 },
  //   { symbol: 'BTC', available: 0.0001 },
  // ]

  try {
    await delay(delayMs);

    const accountInfo = await binance.futuresAccount();

    // Extract only assets with a positive available balance
    const result = accountInfo.assets
      .map(({ asset, availableBalance }) => ({
        symbol: asset,
        available: parseFloat(availableBalance),
      }))
      .filter(({ available }) => available > 0); // Filter out zero balances

    return result;
  } catch (error) {
    throw { type: "Get Account Balances Error", ...error, errorSrcData: error };
  }
}
