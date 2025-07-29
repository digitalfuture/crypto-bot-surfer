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
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
const minGrowthPercent = parseFloat(process.env.SYSTEM_PARAM_3);
const MIN_ACCEPTABLE_VOLUME_USDT = 100000;

// --- Parameters for "pump -> short" strategy ---
// Number of function "calls" back to calculate initial growth (pump)
// With 1-minute heartbeat, this defines the lookback period for the pump
const PUMP_LOOKBACK_CALLS = 2; // Check growth over the last 2 cycles (2 minutes)
// Minimum required price decline or stagnation in the most recent step
// Negative value means price should have declined or stagnated compared to the previous step
const MIN_STALL_DECLINE_PERCENT = -0.01; // E.g., price should not grow more than 0.01% or should decline in the last step
// --- End of additions ---

// --- Internal strategy state ---
let callCount = 0;
// priceHistory stores the last few prices for each symbol
// key: symbol, value: Array of { price: x, call: y }
// We only need to keep a few recent prices, not the entire history
let priceHistory = {};
let lastPriceSnapshot = {}; // For compatibility and reporting
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
        // Add current price with call number
        priceHistory[itemSymbol].push({
          price: currentPrice,
          call: currentCall,
        });

        // Keep only the last few entries needed for calculations
        // We need at least PUMP_LOOKBACK_CALLS + 1 entries
        const maxHistoryLength = Math.max(PUMP_LOOKBACK_CALLS + 1, 5); // A little buffer
        if (priceHistory[itemSymbol].length > maxHistoryLength) {
          // Remove oldest entries
          priceHistory[itemSymbol] =
            priceHistory[itemSymbol].slice(-maxHistoryLength);
        }
        // --- End of price history update ---

        // --- Calculate growth over the pump period ---
        let growthPercent = null;
        // Find the price PUMP_LOOKBACK_CALLS ago
        const pumpStartEntry = priceHistory[itemSymbol]?.find(
          (entry) => entry.call === currentCall - PUMP_LOOKBACK_CALLS
        );

        if (
          pumpStartEntry &&
          pumpStartEntry.price !== undefined &&
          pumpStartEntry.price > 0
        ) {
          growthPercent =
            ((currentPrice - pumpStartEntry.price) / pumpStartEntry.price) *
            100;
        }
        // --- End of growth calculation ---

        // --- Calculate recent price change to check for stall/decline ---
        let recentPriceChangePercent = null;
        // Find the price from the previous call
        const prevCallEntry = priceHistory[itemSymbol]?.find(
          (entry) => entry.call === currentCall - 1
        );

        if (
          prevCallEntry &&
          prevCallEntry.price !== undefined &&
          prevCallEntry.price > 0
        ) {
          recentPriceChangePercent =
            ((currentPrice - prevCallEntry.price) / prevCallEntry.price) * 100;
        }
        // --- End of recent change calculation ---

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
          recentPriceChangePercent: recentPriceChangePercent, // New field
          isCalculatedGrowth: growthPercent !== null,
          isCalculatedRecentChange: recentPriceChangePercent !== null, // New field
          lastPrice: currentPrice,
          volume: vol,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(
        ({ isCalculatedGrowth, isCalculatedRecentChange }) =>
          isCalculatedGrowth && isCalculatedRecentChange
      ) // Need both
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT)
      // --- Apply "pump and stall" filters ---
      .filter(
        ({ growthPercent, recentPriceChangePercent }) =>
          growthPercent >= minGrowthPercent && // Strong pump over PUMP_LOOKBACK_CALLS cycles
          recentPriceChangePercent <= MIN_STALL_DECLINE_PERCENT // Stagnation or decline in the most recent step
      );
    // --- End of "pump and stall" filters ---

    // Sort by descending growth (highest growers first)
    const resolvedTickerList = rawTickerList
      .sort((a, b) => b.growthPercent - a.growthPercent)
      .slice(0, 250);

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
      console.log(
        `🔍 Resolved tokens (after pump&stall filter): ${resolvedTickerList.length}`
      );
      console.log("🔍 No active position. Searching for a short entry...");

      const tokenToConsider = resolvedTickerList[0];

      if (!tokenToConsider) {
        console.log(`No suitable token found after pump&stall filter.`);
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
      // For reporting, use the recent change
      priceChangePercent = token.recentPriceChangePercent ?? 0;

      const futuresPriceForToken = futuresPriceMap.get(token.symbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${token.symbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: priceChangePercent,
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

      price = futuresPriceForToken;
      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      shortPrice = price;
      symbol = token.symbol;
      signal = "SELL";
    } else {
      // Logic for open position remains the same, but uses futures data
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
          // For reporting on fallback
          const prevEntry = lastPriceSnapshot[symbol];
          let fallbackDelta = 0;
          if (prevEntry && prevEntry.price !== undefined) {
            fallbackDelta =
              ((lastPriceFallback - prevEntry.price) / prevEntry.price) * 100;
          }

          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: fallbackDelta,
          };

          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`⚠️ Fallback: ${symbol} restored from prevDayDataSpot`);
          }
          priceChangePercent = fallbackDelta;
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
        // priceChangePercent for reporting on open position (use spot delta for consistency)
        priceChangePercent = currentTicker.priceChangePercent ?? 0;
        // --- End of change ---

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
            callCount: currentCall,
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
