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
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
const minGrowthPercent = parseFloat(process.env.SYSTEM_PARAM_3);
const MIN_ACCEPTABLE_VOLUME_USDT = 100000;

// --- Parameters for "pump -> short" strategy ---
// Number of function "calls" back to calculate initial growth (pump)
const GROWTH_LOOKBACK_CALLS =
  parseInt(process.env.GROWTH_LOOKBACK_CALLS, 10) || 12;
// Number of recent calls to check for price decline/stall after the pump
const STALL_LOOKBACK_CALLS =
  parseInt(process.env.STALL_LOOKBACK_CALLS, 10) || 2;
// Minimum required relative price decline from the pump high to consider a "stall"
const MIN_STALL_DECLINE_PERCENT =
  parseFloat(process.env.MIN_STALL_DECLINE_PERCENT) || -0.1; // E.g., -0.1% decline
// --- End of additions ---

// --- Internal strategy state ---
let callCount = 0;
// priceHistory stores the last few prices for each symbol
// key: symbol, value: Array of { price: x, timestamp: y, call: z }
let priceHistory = {};
let lastPriceSnapshot = {};
// --- End of addition ---

export async function getTradeSignals(state = {}) {
  try {
    callCount++;
    const currentCall = callCount;
    const now = Date.now();

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(`\n--- getTradeSignals Call #${currentCall} ---`);
      console.log(`State symbol: ${state.symbol || "null"}`);
    }

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
    if (process.env.MODE === "DEVELOPMENT") {
      console.log(`Initial raw data items: ${prevDayDataSpot.length}`);
    }

    const rawTickerList = prevDayDataSpot
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const currentPrice = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        // --- Update price history ---
        if (!priceHistory[itemSymbol]) {
          priceHistory[itemSymbol] = [];
        }
        // Add current price with call number and timestamp
        priceHistory[itemSymbol].push({
          price: currentPrice,
          timestamp: now,
          call: currentCall,
        });

        // Keep only the last few entries needed for calculations
        const maxHistoryLength =
          Math.max(GROWTH_LOOKBACK_CALLS, STALL_LOOKBACK_CALLS) + 5; // A buffer
        if (priceHistory[itemSymbol].length > maxHistoryLength) {
          priceHistory[itemSymbol] =
            priceHistory[itemSymbol].slice(-maxHistoryLength);
        }
        // --- End of price history update ---

        // --- Calculate growth over the pump period ---
        let growthPercent = null;
        let pumpHighPrice = null; // The highest price observed during the pump period
        let deltaTimeMs = null;

        const pumpStartEntryIndex = priceHistory[itemSymbol].findIndex(
          (entry) => entry.call === currentCall - GROWTH_LOOKBACK_CALLS
        );

        if (
          pumpStartEntryIndex !== -1 &&
          priceHistory[itemSymbol][pumpStartEntryIndex].price > 0
        ) {
          const pumpStartPrice =
            priceHistory[itemSymbol][pumpStartEntryIndex].price;

          // Calculate growth from pump start to current price
          growthPercent =
            ((currentPrice - pumpStartPrice) / pumpStartPrice) * 100;
          deltaTimeMs =
            now - priceHistory[itemSymbol][pumpStartEntryIndex].timestamp;

          // Find the highest price during the pump period [pumpStartCall, currentCall]
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

        // --- Calculate recent price change to check for stall/decline ---
        let recentPriceChangePercent = null;
        let stallConditionMet = false; // Flag to indicate if stall condition is met

        const stallStartEntryIndex = priceHistory[itemSymbol].findIndex(
          (entry) => entry.call === currentCall - STALL_LOOKBACK_CALLS
        );

        if (
          stallStartEntryIndex !== -1 &&
          priceHistory[itemSymbol][stallStartEntryIndex].price > 0
        ) {
          const stallStartPrice =
            priceHistory[itemSymbol][stallStartEntryIndex].price;
          // Calculate recent change from stall start to current price
          recentPriceChangePercent =
            ((currentPrice - stallStartPrice) / stallStartPrice) * 100;

          // --- Stall condition: Price must have declined or stagnated from pump high ---
          if (
            pumpHighPrice !== null &&
            pumpHighPrice > 0 &&
            currentPrice !== undefined
          ) {
            const relativeDeclineFromHigh =
              ((currentPrice - pumpHighPrice) / pumpHighPrice) * 100;
            // Stall condition is met if price declined from pump high
            stallConditionMet =
              relativeDeclineFromHigh <= MIN_STALL_DECLINE_PERCENT;
            if (
              process.env.MODE === "DEVELOPMENT" &&
              growthPercent !== null &&
              growthPercent > minGrowthPercent
            ) {
              // Log detailed info for candidates that pass the basic pump filter
              console.log(
                `DBG: ${itemSymbol} | Growth: ${growthPercent?.toFixed(4)}% | Recent: ${recentPriceChangePercent?.toFixed(4)}% | Decline from High: ${relativeDeclineFromHigh?.toFixed(4)}% | Stall Met: ${stallConditionMet}`
              );
            }
          }
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
          growthPercent: growthPercent, // Growth from pump start
          recentPriceChangePercent: recentPriceChangePercent, // Recent change
          pumpHighPrice: pumpHighPrice, // The highest price during pump
          stallConditionMet: stallConditionMet, // Whether stall condition is met
          deltaTimeMs: deltaTimeMs,
          isCalculatedGrowth: growthPercent !== null,
          isCalculatedRecentChange: recentPriceChangePercent !== null,
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

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(`After initial filters: ${rawTickerList.length} items`);
      // Log top 5 by volume before pump&stall filter for context
      const topByVolume = [...rawTickerList]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5);
      console.log("Top 5 by volume (before pump&stall filter):");
      topByVolume.forEach((t) =>
        console.log(
          `  ${t.symbol}: Vol=${t.volume.toFixed(0)}, Price=${t.lastPrice.toFixed(6)}`
        )
      );
    }

    // --- Apply "pump and stall" filters ---
    // 1. Strong pump: growthPercent >= minGrowthPercent
    // 2. Stall/decline: stallConditionMet is true (price declined from pump high)
    const pumpAndStallFiltered = rawTickerList.filter(
      ({ growthPercent, stallConditionMet }) => {
        const pumpCondition = growthPercent >= minGrowthPercent;
        const stallCondition = stallConditionMet; // Use the pre-calculated flag

        const passes = pumpCondition && stallCondition;

        if (process.env.MODE === "DEVELOPMENT") {
          // Log details for top candidates that almost pass or pass
          // if (growthPercent !== null && (growthPercent > (minGrowthPercent - 0.5) || Math.abs(growthPercent) < 2)) {
          //     console.log(`  Candidate: ${itemSymbol} | Growth: ${growthPercent?.toFixed(4)}% (need >=${minGrowthPercent}%) | Stall Met: ${stallConditionMet} | Passes: ${passes}`);
          // }
        }
        return passes;
      }
    );
    // --- End of "pump and stall" filters ---

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(
        `After pump&stall filter: ${pumpAndStallFiltered.length} items`
      );
      if (pumpAndStallFiltered.length > 0) {
        console.log("Top candidates after pump&stall filter:");
        pumpAndStallFiltered.slice(0, 3).forEach((t, i) => {
          console.log(
            `  ${i + 1}. ${t.symbol}: Growth=${t.growthPercent?.toFixed(4)}%, Stall Met=${t.stallConditionMet}`
          );
        });
      }
    }

    // Sort by descending growth (highest growers first)
    const resolvedTickerList = pumpAndStallFiltered
      .sort((a, b) => b.growthPercent - a.growthPercent)
      .slice(0, 10); // Show top 10 in logs

    if (!resolvedTickerList.length) {
      if (process.env.MODE === "DEVELOPMENT") {
        console.log("🔍 No tokens passed all filters (pump + stall).");
      }
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

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(`Final resolved list (top 10 sorted by growth):`);
      resolvedTickerList.forEach((t, i) => {
        console.log(
          `  ${i + 1}. ${t.symbol}: Growth=${t.growthPercent?.toFixed(4)}%, Stall Met=${t.stallConditionMet}`
        );
      });
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

      if (process.env.MODE === "DEVELOPMENT") {
        console.log(
          `🎯 Selected token for SELL signal: ${tokenToConsider.symbol}`
        );
        console.log(
          `   Growth: ${tokenToConsider.growthPercent?.toFixed(4)}% (need >=${minGrowthPercent}%)`
        );
        console.log(
          `   Stall Condition Met: ${tokenToConsider.stallConditionMet}`
        );
      }

      const token = tokenToConsider;
      // For reporting, use the recent change or growth for context
      priceChangePercent = token.growthPercent ?? 0;

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

      if (process.env.MODE === "DEVELOPMENT") {
        console.log(
          `✅ Generated SELL signal for ${symbol} at price ${price.toFixed(8)}`
        );
        console.log(
          `   Stop-Loss: ${stopLoss.toFixed(8)} | Take-Profit: ${takeProfit.toFixed(8)}`
        );
      }
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
        if (process.env.MODE === "DEVELOPMENT") {
          console.log(
            `❌ Generated BUY signal (POSITION_NOT_FOUND) for ${symbol}`
          );
          console.log(`DBG: Returning BUY signal with symbol: '${symbol}'`);
        }
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

          if (process.env.MODE === "DEVELOPMENT") {
            console.log(
              `📉 Trailing Stop updated for ${symbol}: ${stopLoss.toFixed(8)}`
            );
          }
        }

        // Check for take-profit and stop-loss
        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(
              `✅ Generated BUY signal (TP) for ${symbol} at price ${price.toFixed(8)}. TP was ${takeProfit.toFixed(8)}`
            );
            console.log(`DBG: Returning BUY signal with symbol: '${symbol}'`);
          }
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(
              `❌ Generated BUY signal (SL) for ${symbol} at price ${price.toFixed(8)}. SL was ${stopLoss.toFixed(8)}`
            );
            console.log(`DBG: Returning BUY signal with symbol: '${symbol}'`);
          }
        } else if (process.env.MODE === "DEVELOPMENT") {
          // Log price check status periodically or if close to levels
          const tpDistance = takeProfit
            ? ((takeProfit - price) / price) * 100
            : null;
          const slDistance = stopLoss
            ? ((price - stopLoss) / price) * 100
            : null;
          console.log(
            `📊 Price check for ${symbol}: Current=${price.toFixed(8)}, TP=${takeProfit?.toFixed(8)} (${tpDistance?.toFixed(2)}% away), SL=${stopLoss?.toFixed(8)} (${slDistance?.toFixed(2)}% away)`
          );
        }
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
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

    // Add debug log before returning BUY signal
    if (signal === "BUY" && process.env.MODE === "DEVELOPMENT") {
      console.log(`DBG: Final Returning BUY signal with symbol: '${symbol}'`);
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
    console.error("Error in getTradeSignals:", error);
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
