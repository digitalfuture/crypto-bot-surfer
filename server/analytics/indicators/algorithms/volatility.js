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
// Note: SYSTEM_PARAM_3 (minGrowthPercent) is no longer used in this version of the strategy
// but kept for potential future use or backward compatibility.
const MIN_ACCEPTABLE_VOLUME_USDT = 100000;

// --- Parameters for modified "pump -> short" strategy ---
// Number of function "calls" back to calculate initial growth (pump)
const PUMP_LOOKBACK_CALLS = 2;
// --- End of additions ---

// --- Internal strategy state ---
let callCount = 0;
// priceHistory stores the last few prices for each symbol
// key: symbol, value: Array of { price: x, call: y }
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

    // --- Form and evaluate candidates based on modified "pump and stall" pattern ---
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
        // Add current price with call number
        priceHistory[itemSymbol].push({
          price: currentPrice,
          call: currentCall,
        });

        // Keep only the last few entries needed for calculations
        const maxHistoryLength = Math.max(PUMP_LOOKBACK_CALLS + 3, 10); // A buffer
        if (priceHistory[itemSymbol].length > maxHistoryLength) {
          priceHistory[itemSymbol] =
            priceHistory[itemSymbol].slice(-maxHistoryLength);
        }
        // --- End of price history update ---

        // --- Calculate growth and pump high over the pump period ---
        let growthPercent = null;
        let pumpHighPrice = null; // The highest price observed during the pump period

        const pumpStartEntryIndex = priceHistory[itemSymbol].findIndex(
          (entry) => entry.call === currentCall - PUMP_LOOKBACK_CALLS
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
        // --- End of growth and pump high calculation ---

        // --- Calculate relative recent price change from pump high to check for stall/decline ---
        let recentPriceChangePercentFromHigh = null;
        // Calculate relative change from the pump high to the current price
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
          growthPercent: growthPercent, // Growth from pump start
          recentPriceChangePercentFromHigh: recentPriceChangePercentFromHigh, // Decline from pump high
          pumpHighPrice: pumpHighPrice, // The highest price during pump
          isCalculatedGrowth: growthPercent !== null,
          isCalculatedRecentChange: recentPriceChangePercentFromHigh !== null,
          lastPrice: currentPrice,
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
        if (process.env.MODE === "DEVELOPMENT" && !keep) {
          // Log why items are filtered out if needed for deep debugging
        }
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

    // Apply modified "pump and stall" filters
    const pumpAndStallFiltered = rawTickerList.filter(
      ({
        growthPercent,
        recentPriceChangePercentFromHigh,
        symbol: itemSymbol,
      }) => {
        // --- Modified condition: Any positive growth is considered a "pump"
        const pumpCondition = growthPercent > 0; // Instead of growthPercent >= minGrowthPercent (SYSTEM_PARAM_3)

        // --- Modified condition: Price must have declined or stagnated from its pump high
        // recentPriceChangePercentFromHigh <= 0 means price is at or below the pump high
        const stallCondition = recentPriceChangePercentFromHigh <= 0;

        const passes = pumpCondition && stallCondition;

        if (process.env.MODE === "DEVELOPMENT") {
          // Log details for candidates that almost pass or pass
          if (
            growthPercent !== null &&
            recentPriceChangePercentFromHigh !== null
          ) {
            console.log(
              `  Candidate: ${itemSymbol} | Growth: ${growthPercent?.toFixed(4)}% (need >0%) | Relative Decline: ${recentPriceChangePercentFromHigh?.toFixed(4)}% (need <=0%) | Passes: ${passes}`
            );
          }
        }
        return passes;
      }
    );

    if (process.env.MODE === "DEVELOPMENT") {
      console.log(
        `After pump&stall filter: ${pumpAndStallFiltered.length} items`
      );
      if (pumpAndStallFiltered.length > 0) {
        console.log("Top candidates after pump&stall filter:");
        pumpAndStallFiltered.slice(0, 3).forEach((t, i) => {
          console.log(
            `  ${i + 1}. ${t.symbol}: Growth=${t.growthPercent?.toFixed(4)}%, Relative Decline=${t.recentPriceChangePercentFromHigh?.toFixed(4)}%`
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
        console.log("No tokens passed all filters.");
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
          `  ${i + 1}. ${t.symbol}: Growth=${t.growthPercent?.toFixed(4)}%, Relative Decline=${t.recentPriceChangePercentFromHigh?.toFixed(4)}%`
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
          `   Growth: ${tokenToConsider.growthPercent?.toFixed(4)}% (need >0%)`
        );
        console.log(
          `   Relative Decline from High: ${tokenToConsider.recentPriceChangePercentFromHigh?.toFixed(4)}% (need <=0%)`
        );
      }

      const token = tokenToConsider;
      // For reporting, use the relative decline
      priceChangePercent = token.recentPriceChangePercentFromHigh ?? 0;

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
          }
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(
              `❌ Generated BUY signal (SL) for ${symbol} at price ${price.toFixed(8)}. SL was ${stopLoss.toFixed(8)}`
            );
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
