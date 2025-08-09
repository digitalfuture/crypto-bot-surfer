// svolatility.js
import util from "node:util";
import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

// --- Environment Variables (Only these can be changed) ---
const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL; // e.g., '5m'
const periods = parseInt(process.env.BACKTEST_PERIODS, 10); // e.g., 24
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1); // e.g., 1.0
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2); // e.g., 3.0
const minGrowthPercent = parseFloat(process.env.SYSTEM_PARAM_3); // e.g., 1.5
// --- End of Environment Variables ---

// --- Hardcoded Strategy Constants (Defined directly in the file) ---
const GROWTH_LOOKBACK_CALLS = 12; // 12 calls * 5s = 1 minute lookback for pump
const MIN_ACCEPTABLE_VOLUME_USDT = 100000; // 100,000 USDT
// --- End of Hardcoded Constants ---

// --- Internal strategy state ---
let callCount = 0;
let priceHistory = {};
let lastPriceSnapshot = {};
// --- End of addition ---

export async function getTradeSignals(state = {}) {
  try {
    callCount++;
    const currentCall = callCount;
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

    // --- Form and evaluate candidates based on "pump and stall" pattern ---
    const rawTickerList = prevDayDataSpot
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const currentPrice = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        // --- Update price history ---
        if (!priceHistory[itemSymbol]) {
          priceHistory[itemSymbol] = [];
        }
        priceHistory[itemSymbol].push({
          price: currentPrice,
          timestamp: now,
          call: currentCall,
        });

        const maxHistoryLength = Math.max(GROWTH_LOOKBACK_CALLS, 5) + 10; // A buffer
        if (priceHistory[itemSymbol].length > maxHistoryLength) {
          priceHistory[itemSymbol] =
            priceHistory[itemSymbol].slice(-maxHistoryLength);
        }
        // --- End of price history update ---

        // --- Calculate growth over the pump period ---
        let growthPercent = null;
        let pumpHighPrice = null;

        const pumpStartEntryIndex = priceHistory[itemSymbol].findIndex(
          (entry) => entry.call === currentCall - GROWTH_LOOKBACK_CALLS
        );

        if (
          pumpStartEntryIndex !== -1 &&
          priceHistory[itemSymbol][pumpStartEntryIndex].price > 0
        ) {
          const pumpStartPrice =
            priceHistory[itemSymbol][pumpStartEntryIndex].price;

          growthPercent =
            ((currentPrice - pumpStartPrice) / pumpStartPrice) * 100;

          let maxPriceInPeriod = pumpStartPrice;
          for (
            let i = pumpStartEntryIndex;
            i < priceHistory[itemSymbol].length;
            i++
          ) {
            const priceInPeriod = priceHistory[itemSymbol][i].price;
            if (priceInPeriod > maxPriceInPeriod) {
              maxPriceInPeriod = priceInPeriod;
            }
          }
          pumpHighPrice = maxPriceInPeriod;
        }
        // --- End of growth calculation ---

        // --- Calculate relative recent price change from pump high to check for stall/decline ---
        let recentPriceChangePercentFromHigh = null;
        if (
          pumpHighPrice !== null &&
          pumpHighPrice > 0 &&
          currentPrice !== undefined
        ) {
          recentPriceChangePercentFromHigh =
            ((currentPrice - pumpHighPrice) / pumpHighPrice) * 100;
        }
        // --- End of relative recent change calculation ---

        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

        // Update lastPriceSnapshot for compatibility (fallback, reporting)
        lastPriceSnapshot[itemSymbol] = {
          price: currentPrice,
          timestamp: now,
        };

        return {
          primarySymbol,
          secondarySymbol,
          symbol: itemSymbol,
          growthPercent: growthPercent,
          recentPriceChangePercentFromHigh: recentPriceChangePercentFromHigh,
          pumpHighPrice: pumpHighPrice,
          isCalculatedGrowth: growthPercent !== null,
          isCalculatedRecentChange: recentPriceChangePercentFromHigh !== null,
          lastPrice: currentPrice, // Spot price
          volume: vol,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedGrowth, isCalculatedRecentChange }) => {
        const keep = isCalculatedGrowth && isCalculatedRecentChange;
        return keep;
      })
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT);

    // Apply "pump and stall" filters
    const pumpAndStallFiltered = rawTickerList.filter(
      ({ growthPercent, recentPriceChangePercentFromHigh }) => {
        const pumpCondition = growthPercent >= minGrowthPercent;
        const stallCondition = recentPriceChangePercentFromHigh <= 0;
        const passes = pumpCondition && stallCondition;
        return passes;
      }
    );

    // Sort by descending growth (highest growers first)
    const resolvedTickerList = pumpAndStallFiltered
      .sort((a, b) => b.growthPercent - a.growthPercent)
      .slice(0, 5);

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
    let price = null; // This will be the futures price for orders
    let priceChangePercent = 0; // For reporting

    if (!symbol) {
      const tokenToConsider = resolvedTickerList[0];

      if (!tokenToConsider) {
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

      // --- Изменено: Для отчета используем изменение спот-цены за последний шаг ---
      const prevEntry = lastPriceSnapshot[token.symbol];
      let sellSignalPriceChangePercent = 0;
      if (prevEntry && prevEntry.price !== undefined && token.lastPrice > 0) {
        sellSignalPriceChangePercent =
          ((token.lastPrice - prevEntry.price) / prevEntry.price) * 100;
      }
      priceChangePercent = sellSignalPriceChangePercent; // Для отчета
      // --- Конец изменения ---

      const futuresPriceForToken = futuresPriceMap.get(token.symbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${token.symbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: priceChangePercent, // Передаем рассчитанное изменение
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const candles = await getCandlestickData({
        symbol: token.symbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      price = futuresPriceForToken; // Futures price for the order
      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      shortPrice = price; // Short price is the entry price
      symbol = token.symbol;
      signal = "SELL";
    } else {
      // Logic for open position
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
        // Fallback to spot data if main list doesn't contain position
        const raw = prevDayDataSpot.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");

        if (lastPriceFallback > 0) {
          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: 0, // Initialize fallback price change
          };
          priceChangePercent = 0; // Use 0 for fallback report
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        // --- Use futures price to check TP/SL ---
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice;
        // priceChangePercent for reporting on open position
        priceChangePercent = currentTicker.priceChangePercent ?? 0;
        // --- End of change ---

        // Trailing stop logic (update stopLoss and shortPrice)
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

        // Check for take-profit and stop-loss
        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
        }
        // If none of the above, signal remains null, implying HOLD
      }
    }

    // --- Centralized logging block ---
    if (process.env.MODE === "DEVELOPMENT") {
      if (signal === "SELL") {
        console.log(
          `✅ SELL: ${symbol} | Growth: ${resolvedTickerList[0]?.growthPercent?.toFixed(2) || "N/A"}% | Stall: ${resolvedTickerList[0]?.recentPriceChangePercentFromHigh?.toFixed(2) || "N/A"}%`
        );
      } else if (signal === "BUY") {
        if (exitReason === "TP") {
          console.log(
            `✅ BUY (TP) for ${symbol} at price ${price?.toFixed(8) || "N/A"}. TP was ${takeProfit?.toFixed(8) || "N/A"}`
          );
        } else if (exitReason === "SL") {
          console.log(
            `❌ BUY (SL) for ${symbol} at price ${price?.toFixed(8) || "N/A"}. SL was ${stopLoss?.toFixed(8) || "N/A"}`
          );
        } else if (exitReason === "POSITION_NOT_FOUND") {
          console.log(`❌ BUY (POSITION_NOT_FOUND) for ${symbol}`);
        }
      } else if (!symbol) {
        console.log("🔍 No suitable token found for short entry.");
      } else {
        // This implies HOLD (signal is null, but symbol state exists)
        console.log(`📈 Holding position on ${symbol}.`);
      }

      // Final detailed signal log
      console.log("Final Trade Signal: ");
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
            callCount: currentCall,
          },
          { depth: null, colors: true }
        )
      );
      console.log("--- End of getTradeSignals Call ---\n");
    }
    // --- End of centralized logging block ---

    return {
      symbol,
      price, // Futures price for order execution
      priceChangePercent, // Change used for reporting
      signal,
      stopLoss, // Stop Loss level
      takeProfit, // Take Profit level
      shortPrice, // Entry price (same as 'price' for shorts)
    };
  } catch (error) {
    console.error("Error in getTradeSignals:", error);
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
