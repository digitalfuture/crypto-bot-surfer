// getTradeSignals.js
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

// <<<--- Stop-Loss multiplier
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
// <<<--- Take Profit multiplier using SYSTEM_PARAM_2 ---
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
// <<<--- Minimum price change percent using SYSTEM_PARAM_3 ---
const minPriceChangePercent = parseFloat(process.env.SYSTEM_PARAM_3);

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayDataSpot = await getPrevDayData(); // <<<--- Spot data for signals
    // <<<--- Fetch futures data ---
    const prevDayDataFuturesRaw = await getPrevDayDataFutures();
    // Create a Map for quick lookup of futures price by symbol
    const futuresPriceMap = new Map();
    if (prevDayDataFuturesRaw && Array.isArray(prevDayDataFuturesRaw)) {
      prevDayDataFuturesRaw.forEach((item) => {
        if (item.symbol && item.symbol.endsWith(secondarySymbol)) {
          futuresPriceMap.set(item.symbol, parseFloat(item.lastPrice));
        }
      });
    }
    // <<<--- End of addition ---

    let {
      symbol = null,
      stopLoss = null,
      shortPrice = null,
      takeProfit = null,
    } = state;

    // <<<--- Signals are formed based on SPOT data ---
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
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedDelta }) => isCalculatedDelta)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 1000);

    if (!resolvedTickerList.length) {
      return {
        symbol: null,
        price: null, // Futures price
        priceChangePercent: 0,
        signal: null,
        stopLoss: null,
        takeProfit: null,
        shortPrice: null, // Futures price
      };
    }

    let signal = null;
    let exitReason = null;
    let price = null; // <<<--- Futures price returned in the signal
    let priceChangePercent = 0;

    if (!symbol) {
      console.log(`🔍 Resolved tokens: ${resolvedTickerList.length}`);
      console.log("🔍 No active position. Searching for a short entry...");

      // <<<--- Filtering based on spot (without isNearChannelTop) ---
      // Originally was filterTickersNearChannelTop, but without using isNearChannelTop
      // it just returned the same tokens as input. Simplified to sorting by priceChangePercent.
      // const filteredList = await filterTickersNearChannelTop(...);
      const filteredList = resolvedTickerList; // <<<--- Simplification

      if (filteredList.length === 0) {
        return {
          symbol: null,
          price: null, // Futures price
          priceChangePercent: 0,
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null, // Futures price
        };
      }

      // Sort by descending price change
      const sortedList = filteredList.sort(
        (a, b) => b.priceChangePercent - a.priceChangePercent
      );

      // <<<--- Filter by minimum price change percent ---
      const tokenToConsider = sortedList[0]; // Token with maximum drop
      if (
        !tokenToConsider ||
        tokenToConsider.priceChangePercent < minPriceChangePercent
      ) {
        console.log(
          `No suitable token found. Best candidate ${tokenToConsider?.symbol || "N/A"} changed by ${tokenToConsider?.priceChangePercent?.toFixed(4) || "N/A"}%, below threshold of ${minPriceChangePercent}%.`
        );
        // Return empty signal
        return {
          symbol: null,
          price: null, // Futures price
          priceChangePercent: 0,
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null, // Futures price
        };
      }
      const token = tokenToConsider; // If it passed the filter, use it
      // <<<--- End of addition ---

      const { symbol: tokenSymbol, priceChangePercent: tokenDelta } = token;

      // <<<--- Get futures price for the selected spot token ---
      const futuresPriceForToken = futuresPriceMap.get(tokenSymbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${tokenSymbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null, // Futures price
          priceChangePercent: 0,
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null, // Futures price
        };
      }

      // <<<--- Candle data for volatility is taken from spot ---
      const candles = await getCandlestickData({
        symbol: tokenSymbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      // <<<--- Use FUTURES PRICE for all calculations and return ---
      price = futuresPriceForToken; // <<<--- Futures price
      priceChangePercent = tokenDelta;
      stopLoss = price * (1 + volatility * stopMultiplier);
      // <<<--- Take Profit calculation using SYSTEM_PARAM_2 ---
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      // <<<--- End of addition ---
      shortPrice = price; // <<<--- Futures price
      symbol = tokenSymbol;
      signal = "SELL";
    } else {
      // Logic for an open position (holding/closing)
      let currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      // <<<--- Get futures price for the open position ---
      const currentFuturesPrice = futuresPriceMap.get(symbol);
      if (currentFuturesPrice === undefined || currentFuturesPrice <= 0) {
        console.warn(
          `Could not get futures price for open position ${symbol}.`
        );
        // Could close position or handle differently
      }
      // <<<--- End of addition ---

      if (!currentTicker) {
        // Fallback to spot data
        const raw = prevDayDataSpot.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");

        if (lastPriceFallback > 0) {
          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback, // Spot price (fallback)
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
        // <<<--- Use FUTURES PRICE to check TP/SL ---
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice; // Futures price or fallback
        priceChangePercent = currentTicker.priceChangePercent;

        // Trailing stop logic (update stopLoss and shortPrice)
        // Use futures price for calculations
        if (price < shortPrice || shortPrice === null) {
          // Recalculate volatility based on spot (signal logic)
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
          const troughPrice = price; // <<<--- Futures price
          const newTrailingStop = troughPrice * (1 + dynamicFactor);

          stopLoss =
            stopLoss !== null
              ? Math.min(stopLoss, newTrailingStop)
              : newTrailingStop;
          shortPrice = troughPrice; // <<<--- Futures price
        }

        // <<<--- Check for Take Profit and Stop Loss ---
        // Assuming SHORT: TP < entry, SL > entry
        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP"; // Take Profit
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL"; // Stop Loss
        }
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
      console.log("Trade Signal: ");
      console.log(
        util.inspect(
          {
            symbol,
            price, // <<<--- Futures price
            stopLoss,
            takeProfit, // <<<--- takeProfit to log
            priceChangePercent,
            signal,
            exitReason,
            shortPrice, // <<<--- Futures price
          },
          { depth: null, colors: true }
        )
      );
    }

    // <<<--- Return futures price and takeProfit ---
    return {
      symbol,
      price, // <<<--- Futures price
      priceChangePercent,
      signal,
      stopLoss,
      takeProfit, // <<<--- Return calculated TP
      shortPrice, // <<<--- Futures price
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}

// <<<--- Removed: function isNearChannelTop and filterTickersNearChannelTop ---
// As isNearChannelTop was unused, filterTickersNearChannelTop
// was simplified to sorting in the main logic block.
