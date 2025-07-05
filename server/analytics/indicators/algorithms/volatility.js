// volatility.js

import {
  getCandlestickData,
  getTradingTickers,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL; // e.g. "USDT"
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
let takeMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
let topGainerIndex = parseInt(process.env.SYSTEM_PARAM_3);

let lastPriceSnapshot = {};
let stopLoss = null;
let takeProfit = null;
let symbol = null;
let price = null;
let shortPrice = null;
let signal = null;
let priceChangePercent = 0;
let exitReason = null;

export async function getTradeSignals() {
  try {
    const now = Date.now();
    const tradingTickers = await getTradingTickers();
    const prevDayDataFFutures = await getPrevDayDataFutures();

    // Map tickers with delta price calculation and filter needed symbols
    const resolvedTickerList = prevDayDataFFutures
      .map((item) => {
        const { symbol, lastPrice, volume } = item;
        const price = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        const prevEntry = lastPriceSnapshot[symbol];
        let delta = null;

        if (prevEntry && prevEntry.price !== undefined) {
          delta = ((price - prevEntry.price) / prevEntry.price) * 100;
        }

        lastPriceSnapshot[symbol] = {
          price: price,
          timestamp: now,
        };

        // Extract primarySymbol by removing secondarySymbol suffix
        const primarySymbol = symbol.replace(secondarySymbol, "");

        return {
          primarySymbol,
          secondarySymbol,
          symbol,
          priceChangePercent: delta,
          isCalculatedDelta: delta !== null,
          lastPrice: price,
          volume: vol,
        };
      })
      // Filters:
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol, secondarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(({ isCalculatedDelta }) => isCalculatedDelta)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100); // Top 100 by volume

    if (resolvedTickerList.length === 0) {
      return {
        symbol: null,
        price: null,
        priceChangePercent,
        signal: null,
      };
    }

    // Pick top gainer by priceChangePercent from top 100 by volume
    const topGainer = resolvedTickerList.sort(
      (a, b) => b.priceChangePercent - a.priceChangePercent
    )[topGainerIndex];

    const candlesticks = await getCandlestickData({
      symbol: topGainer.symbol,
      interval,
      periods,
    });

    // Calculate average volatility
    const volatility =
      candlesticks.reduce((acc, [, , high, low, close]) => {
        return acc + Math.abs((high - low) / close);
      }, 0) / candlesticks.length;

    if (!symbol && lastPriceSnapshot) {
      // No active position - signal to open short on topGainer
      symbol = topGainer.symbol;
      price = topGainer.lastPrice;
      priceChangePercent = topGainer.priceChangePercent;

      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeMultiplier);
      signal = "SELL";
      shortPrice = price;
    } else if (symbol) {
      // Active short position on symbol, check exit conditions
      const currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      priceChangePercent = currentTicker.priceChangePercent;
      symbol = currentTicker.symbol;
      price = currentTicker.lastPrice;

      // Adjust trailing stop if price decreases further
      if (price < shortPrice) {
        const dynamicFactor = stopMultiplier * volatility * 1.2;
        const troughPrice = price;
        const newTrailingStop = troughPrice * (1 + dynamicFactor);
        stopLoss = Math.min(stopLoss, newTrailingStop);
      }

      // Check stop loss or take profit hit
      if (price >= stopLoss) {
        signal = "BUY";
        exitReason = "SL";
      } else if (price <= takeProfit) {
        signal = "BUY";
        exitReason = "TP";
      }

      if (signal === "BUY") {
        stopLoss = null;
        takeProfit = null;
        shortPrice = null;
      } else {
        signal = null;
      }
    }

    // Debug logs for development mode
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

    const result = {
      symbol,
      price,
      priceChangePercent,
      signal,
    };

    if (signal === "BUY") symbol = null;

    return result;
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error };
  }
}
