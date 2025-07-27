// strategies/volatility/getTradeSignals.js
import util from "node:util";
import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
// Multiplier for calculating Stop-Loss (SL = price * (1 + volatility * SYSTEM_PARAM_1))
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
// Multiplier for calculating Take-Profit (TP = price * (1 - volatility * SYSTEM_PARAM_2))
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
// Minimum price change percentage required to generate a SELL signal
const minPriceChangePercent = parseFloat(process.env.SYSTEM_PARAM_3);
// Minimum acceptable 24h volume in USDT for a token to be considered
const MIN_ACCEPTABLE_VOLUME_USDT = 100000; // 100,000 USDT

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayDataSpot = await getPrevDayData();
    const prevDayDataFuturesRaw = await getPrevDayDataFutures();

    const futuresPriceMap = new Map();
    if (prevDayDataFuturesRaw && Array.isArray(prevDayDataFuturesRaw)) {
      prevDayDataFuturesRaw.forEach((item) => {
        if (item.symbol && item.symbol.endsWith(secondarySymbol)) {
          futuresPriceMap.set(item.symbol, parseFloat(item.lastPrice));
        }
      });
    }

    let {
      symbol = null,
      stopLoss = null,
      shortPrice = null,
      takeProfit = null,
    } = state;

    const resolvedTickerList = prevDayDataSpot
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
          lastPrice: price, // Spot price
          volume: vol,
        };
      })
      .sort((a, b) => b.volume - a.volume)
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedDelta }) => isCalculatedDelta)
      // Filter by minimum volume to avoid low-liquidity pairs
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT)
      .slice(0, 500);

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

      const filteredList = resolvedTickerList;

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

      const tokenToConsider = sortedList[0];

      // Check if the price change meets our minimum threshold
      if (
        !tokenToConsider ||
        tokenToConsider.priceChangePercent < minPriceChangePercent
      ) {
        console.log(
          `No suitable token found. Best candidate ${tokenToConsider?.symbol || "N/A"} changed by ${tokenToConsider?.priceChangePercent?.toFixed(4) || "N/A"}%, below threshold of ${minPriceChangePercent}%.`
        );
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

      const token = tokenToConsider;

      const { symbol: tokenSymbol, priceChangePercent: tokenDelta } = token;

      const futuresPriceForToken = futuresPriceMap.get(tokenSymbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${tokenSymbol}. Skipping signal.`
        );
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

      const candles = await getCandlestickData({
        symbol: tokenSymbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      price = futuresPriceForToken;
      priceChangePercent = tokenDelta;
      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      shortPrice = price;
      symbol = tokenSymbol;
      signal = "SELL";
    } else {
      let currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      const currentFuturesPrice = futuresPriceMap.get(symbol);
      if (currentFuturesPrice === undefined || currentFuturesPrice <= 0) {
        console.warn(
          `Could not get futures price for open position ${symbol}.`
        );
      }

      if (!currentTicker) {
        const raw = prevDayDataSpot.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");

        if (lastPriceFallback > 0) {
          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: 0,
          };

          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`⚠️ Fallback: ${symbol} restored from prevDayDataSpot`);
          }
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice;
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

        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
        } else if (stopLoss !== null && price >= stopLoss) {
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
            takeProfit,
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
      takeProfit,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
