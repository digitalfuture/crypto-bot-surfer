// volatility.js

import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
let takeMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
let topIndex = parseInt(process.env.SYSTEM_PARAM_3);

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayData = await getPrevDayData();

    let {
      symbol = null,
      stopLoss = null,
      takeProfit = null,
      shortPrice = null,
    } = state;

    const resolvedTickerList = prevDayData
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const price = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        const prevEntry = lastPriceSnapshot[itemSymbol];
        let delta = null;

        if (prevEntry && prevEntry.price !== undefined) {
          delta = ((price - prevEntry.price) / prevEntry.price) * 100;
        }

        lastPriceSnapshot[itemSymbol] = {
          price: price,
          timestamp: now,
        };

        const primarySymbol = itemSymbol.replace(secondarySymbol, "");

        return {
          primarySymbol,
          secondarySymbol,
          symbol: itemSymbol,
          priceChangePercent: delta,
          isCalculatedDelta: delta !== null,
          lastPrice: price,
          volume: vol,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol, secondarySymbol }) =>
        tradingTickersFutures.includes(primarySymbol + secondarySymbol)
      )
      .filter(({ isCalculatedDelta }) => isCalculatedDelta);

    if (resolvedTickerList.length === 0) {
      return {
        symbol: null,
        price: null,
        priceChangePercent: 0,
        signal: null,
        stopLoss: null,
        takeProfit: null,
        shortPrice: null,
      };
    }

    const topGainer = resolvedTickerList
      .filter(({ volume }) => volume > 1000)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100)
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)[topIndex];

    const candlesticks = await getCandlestickData({
      symbol: topGainer.symbol,
      interval,
      periods,
    });

    const volatility =
      candlesticks.reduce((acc, [, , high, low, close]) => {
        return acc + Math.abs((high - low) / close);
      }, 0) / candlesticks.length;

    let priceChangePercent = 0;
    let price = null;
    let signal = null;
    let exitReason = null;

    if (!symbol) {
      price = topGainer.lastPrice;
      priceChangePercent = topGainer.priceChangePercent;

      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeMultiplier);
      signal = "SELL";
      shortPrice = price;
      symbol = topGainer.symbol;
    } else {
      const currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        priceChangePercent = currentTicker.priceChangePercent;
        price = currentTicker.lastPrice;

        if (price < shortPrice || shortPrice === null) {
          const dynamicFactor = stopMultiplier * volatility * 1.2;
          const troughPrice = price;
          const newTrailingStop = troughPrice * (1 + dynamicFactor);
          stopLoss =
            stopLoss !== null
              ? Math.min(stopLoss, newTrailingStop)
              : newTrailingStop;
          shortPrice = troughPrice;
        }

        if (price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
        } else if (price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
        }

        if (signal !== "BUY") {
          signal = null;
        }
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
      console.log("===========================");
      console.log("symbol:", symbol);
      console.log("price:", price);
      console.log("stopLoss:", stopLoss);
      console.log("takeProfit:", takeProfit);
      console.log("priceChangePercent:", priceChangePercent);
      console.log("signal:", signal);
      console.log("exitReason:", exitReason);
      console.log("===========================\n");
    }

    return {
      symbol,
      price,
      priceChangePercent,
      signal,
      stopLoss,
      takeProfit,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error };
  }
}
