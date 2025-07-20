import util from "node:util";
import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayData = await getPrevDayData();

    let { symbol = null, stopLoss = null, shortPrice = null } = state;

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

        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

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
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.startsWith("USD"))
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

      const filteredList = await filterTickersNearChannelTop(
        resolvedTickerList,
        interval,
        periods,
        0.9,
        0.015 // 1.5% минимальный размер канала
      );

      if (filteredList.length === 0) {
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

      const sortedList = filteredList.sort(
        (a, b) => b.priceChangePercent - a.priceChangePercent
      );

      const token = sortedList[0];

      const {
        symbol: tokenSymbol,
        lastPrice,
        priceChangePercent: tokenDelta,
      } = token;

      const candles = await getCandlestickData({
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
        const raw = prevDayData.find((t) => t.symbol === symbol);
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
          const candles = await getCandlestickData({
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
      console.log("Trade Signal: ");
      console.log(
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

function isNearChannelTop(
  candles,
  currentPrice,
  threshold = 0.9,
  minRange = 0.015
) {
  const highs = candles.map((c) => c[2]);
  const lows = candles.map((c) => c[3]);

  const channelHigh = Math.max(...highs);
  const channelLow = Math.min(...lows);
  const range = channelHigh - channelLow;

  if (range === 0) return false;

  const rangePercent = range / channelLow;
  if (rangePercent < minRange) {
    return false;
  }

  const positionInRange = (currentPrice - channelLow) / range;
  const hasPulledBack = currentPrice < channelHigh * 0.995; // хотя бы 0.5% откат

  return positionInRange >= threshold && hasPulledBack;
}

async function filterTickersNearChannelTop(
  tickerList,
  interval,
  periods,
  threshold = 0.9,
  minRange = 0.015
) {
  console.log(
    util.format(
      "Filtering %d tickers near channel top (threshold=%.2f, minRange=%.2f%%)...",
      tickerList.length,
      threshold,
      minRange * 100
    )
  );

  const filtered = [];

  for (const token of tickerList) {
    try {
      console.log(util.format("Checking %s...", token.symbol));

      const candles = await getCandlestickData({
        symbol: token.symbol,
        interval,
        periods,
      });

      const nearTop = isNearChannelTop(
        candles,
        token.lastPrice,
        threshold,
        minRange
      );

      console.log(
        util.inspect(
          {
            symbol: token.symbol,
            price: token.lastPrice,
            nearChannelTop: nearTop,
            candleCount: candles.length,
          },
          { colors: true, depth: 2 }
        )
      );

      if (nearTop) {
        filtered.push(token);
        console.log(util.format("%s added to filtered list.", token.symbol));
      }
    } catch (error) {
      console.error(
        util.format("Error fetching candles for %s:", token.symbol),
        error
      );
    }
  }

  console.log(
    util.format(
      "Filtering done. %d tickers near channel top found.",
      filtered.length
    )
  );
  return filtered;
}
