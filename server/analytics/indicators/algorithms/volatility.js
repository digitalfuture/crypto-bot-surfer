// volatility.js

import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL; // e.g. "USDT"
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
let takeMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
let topIndex = parseInt(process.env.SYSTEM_PARAM_3);

let lastPriceSnapshot = {};

export async function getTradeSignals(symbol = null) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayData = await getPrevDayData();

    // Map tickers with delta price calculation and filter needed symbols
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

        // Extract primarySymbol by removing secondarySymbol suffix
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
      // Filters:
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
      };
    }

    // Pick top gainer by priceChangePercent from top 100 by volume
    const topGainer = resolvedTickerList
      .filter(({ volume }) => volume > 1000)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100) // Top 100 by volume
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)[topIndex];

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

    let stopLoss = null;
    let takeProfit = null;
    let priceChangePercent = 0;
    let price = null;
    let shortPrice = null;
    let signal = null;
    let exitReason = null;

    if (!symbol) {
      // No active position - signal to open short on topGainer
      price = topGainer.lastPrice;
      priceChangePercent = topGainer.priceChangePercent;

      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeMultiplier);
      signal = "SELL";
      shortPrice = price;
      symbol = topGainer.symbol;
    } else {
      // Active short position on symbol, check exit conditions
      const currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      if (!currentTicker) {
        // Position symbol not found, close position
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        priceChangePercent = currentTicker.priceChangePercent;
        price = currentTicker.lastPrice;

        // Adjust trailing stop if price decreases further
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

        // Check stop loss or take profit hit
        if (price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
        } else if (price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
        }

        if (signal !== "BUY") {
          signal = null; // Hold position
        }
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

    return {
      symbol,
      price,
      priceChangePercent,
      signal,
      exitReason,
      stopLoss,
      takeProfit,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error };
  }
}
