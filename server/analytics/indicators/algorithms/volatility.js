import util from "node:util";
import {
  getCandlestickDataFutures,
  getTradingTickersFutures,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayDataFutures = await getPrevDayDataFutures();

    let { symbol = null, stopLoss = null, shortPrice = null } = state;

    const resolvedTickerList = prevDayDataFutures
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
      .filter(({ volume }) => volume >= 5_000_000)
      .filter(({ isCalculatedDelta }) => isCalculatedDelta);

    if (!resolvedTickerList.length) {
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

    let signal = null;
    let exitReason = null;
    let price = null;
    let priceChangePercent = 0;

    if (!symbol) {
      console.log(`🔍 Resolved tokens: ${resolvedTickerList.length}`);

      console.log("🔍 No active position. Searching for a short entry...");

      const sortedList = resolvedTickerList.sort(
        (a, b) => a.priceChangePercent - b.priceChangePercent
      );

      console.log(
        "Top 100 tokens by price change percent:",
        sortedList.slice(0, 5)
      );

      const token = sortedList[0];
      const {
        symbol: tokenSymbol,
        lastPrice,
        priceChangePercent: tokenDelta,
      } = token;
      console.log(`Checking ${tokenSymbol}...`);

      const candles = await getCandlestickDataFutures({
        symbol: tokenSymbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      price = lastPrice;
      priceChangePercent = tokenDelta;
      stopLoss = price * (1 + volatility * stopMultiplier);
      shortPrice = price;
      symbol = tokenSymbol;
      signal = "SELL";
    } else {
      let currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      if (!currentTicker) {
        const raw = prevDayDataFutures.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");
        if (lastPriceFallback > 0) {
          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: 0,
          };
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(
              `⚠️ Fallback: ${symbol} restored from prevDayDataFutures`
            );
          }
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        price = currentTicker.lastPrice;
        priceChangePercent = currentTicker.priceChangePercent;

        if (price < shortPrice || shortPrice === null) {
          const candles = await getCandlestickDataFutures({
            symbol,
            interval,
            periods,
          });

          const volatility =
            candles.reduce((acc, [, , high, low, close]) => {
              return acc + Math.abs((high - low) / close);
            }, 0) / candles.length;

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
        }
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(
        "\n" +
          util.inspect(
            {
              symbol,
              price,
              stopLoss,
              priceChangePercent,
              signal,
              exitReason,
              shortPrice,
            },
            { depth: null, colors: true }
          )
      );
    }

    return {
      symbol,
      price,
      priceChangePercent,
      signal,
      stopLoss,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
