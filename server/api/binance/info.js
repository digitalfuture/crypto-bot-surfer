// info.js

import binance from "./connection.js";
import { delay } from "../../helpers/functions.js";

const delayMs = JSON.parse(process.env.DELAY);

export async function getExchangeInfo(tickerName) {
  try {
    await delay(delayMs);

    const data = await binance.exchangeInfo();
    // console.info("\nExchangeInfo:", data);

    const tickerInfo = data.symbols.find(
      (ticker) => ticker.symbol === tickerName
    );
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

    const tickerLimits = limits[tickerName];
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

export async function getLastPrice(tickerName) {
  try {
    await delay(delayMs);

    const priceList = await binance.prices();
    const tickerPrice = parseFloat(priceList[tickerName]);

    return tickerPrice;
  } catch (error) {
    throw { type: "Get Last Price", ...error, errorSrcData: error };
  }
}

export async function getPrevDayData(tickerName) {
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

    if (tickerName) {
      const data = await binance.prevDay(tickerName);
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

export async function getTradingHistory(tickerName) {
  try {
    await delay(delayMs);

    return await binance.trades(tickerName);
  } catch (error) {
    throw { type: "Get Trading History Error", ...error, errorSrcData: error };
  }
}

export async function getCandlestickData({
  tickerName,
  interval,
  periods,
  endTime = Date.now(),
}) {
  try {
    await delay(delayMs);

    const candlesticks = await binance.candlesticks(tickerName, interval, {
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
    //   `${tickerName} OHLCV data loaded for last ${periods} ${interval} intervals`
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

export function getMarketAverage(tickerList, btcUsdtPrice) {
  return tickerList.reduce((sum, { lastPrice }, idx, arr) => {
    return idx === arr.length - 1
      ? (sum + parseFloat(lastPrice) - btcUsdtPrice) / arr.length
      : sum + parseFloat(lastPrice);
  }, 0);
}

export function getMarketGrowLevel(tickerList) {
  const tickerListUp = tickerList.filter(
    ({ priceChangePercent }) => priceChangePercent > 0
  ).length;

  return (tickerListUp / tickerList.length) * 100;
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

export async function getPrevDayDataFutures(tickerName) {
  // prevDayDataFutures
  //
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
  //   },
  //    ...
  // ];

  try {
    await delay(delayMs);

    if (tickerName) {
      const data = await binance.prevDay(tickerName);
      return [data];
    } else {
      const data = await binance.prevDay(false);
      return data;
    }
  } catch (error) {
    throw { type: "Get Prev Day Data", ...error, errorSrcData: error };
  }
}
