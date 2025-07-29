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
// Minimum price change percentage (GROWTH) required to generate a SELL signal
const minGrowthPercent = parseFloat(process.env.SYSTEM_PARAM_3);
// Minimum acceptable 24h volume in USDT for a token to be considered
const MIN_ACCEPTABLE_VOLUME_USDT = 100000; // 100,000 USDT

// --- Added: Parameters for "growth -> short" strategy ---
// Number of function "calls" back to compare price for identifying short candidates
const GROWTH_LOOKBACK_CALLS =
  parseInt(process.env.GROWTH_LOOKBACK_CALLS, 10) || 12; // Default 12 calls
// --- End of addition ---

// --- Added: Internal strategy state ---
// Counter for function calls to getTradeSignals
let callCount = 0;
// Price history for calculating growth
// key: symbol, value: Array of { price: x, timestamp: y, call: z }
let priceHistory = {};
// --- End of addition ---

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    // --- Added: Increment call counter ---
    callCount++;
    const currentCall = callCount;
    // --- End of addition ---

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

    // --- Changed: Logic for forming and evaluating candidates ---
    // 1. First, update price history and form the candidate list
    const rawTickerList = prevDayDataSpot
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const currentPrice = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        // --- Added: Update price history ---
        if (!priceHistory[itemSymbol]) {
          priceHistory[itemSymbol] = [];
        }
        priceHistory[itemSymbol].push({
          price: currentPrice,
          timestamp: now,
          call: currentCall, // Use internal call counter
        });

        // Limit history size to prevent unbounded growth
        // Store a bit more than needed for lookback, in case of skips
        if (priceHistory[itemSymbol].length > GROWTH_LOOKBACK_CALLS * 3) {
          priceHistory[itemSymbol].shift();
        }
        // --- End of addition ---

        // --- Changed: Calculate growth over the period ---
        let growthPercent = null;
        let deltaTimeMs = null;

        // Find the entry in history that was GROWTH_LOOKBACK_CALLS calls ago
        const pastEntryIndex = priceHistory[itemSymbol].findIndex(
          (entry) => entry.call === currentCall - GROWTH_LOOKBACK_CALLS
        );
        const pastEntry =
          pastEntryIndex !== -1
            ? priceHistory[itemSymbol][pastEntryIndex]
            : null;

        if (pastEntry && pastEntry.price !== undefined && pastEntry.price > 0) {
          growthPercent =
            ((currentPrice - pastEntry.price) / pastEntry.price) * 100;
          deltaTimeMs = now - pastEntry.timestamp;
        }
        // --- End of change ---

        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

        // Update lastPriceSnapshot for compatibility with reports and fallback logic
        const prevEntryForDelta = lastPriceSnapshot[itemSymbol];
        let deltaForReporting = null;
        if (prevEntryForDelta && prevEntryForDelta.price !== undefined) {
          deltaForReporting =
            ((currentPrice - prevEntryForDelta.price) /
              prevEntryForDelta.price) *
            100;
        }
        lastPriceSnapshot[itemSymbol] = {
          price: currentPrice,
          timestamp: now,
        };

        return {
          primarySymbol,
          secondarySymbol,
          symbol: itemSymbol,
          growthPercent: growthPercent, // Use growthPercent instead of priceChangePercent
          deltaTimeMs: deltaTimeMs,
          isCalculatedGrowth: growthPercent !== null,
          lastPrice: currentPrice, // Spot price
          volume: vol,
          // For compatibility and reports
          priceChangePercent: deltaForReporting,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedGrowth }) => isCalculatedGrowth) // Filter by presence of growth calculation
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT);

    // 2. Sort by descending growth (highest growers first)
    const resolvedTickerList = rawTickerList
      .sort((a, b) => b.growthPercent - a.growthPercent) // Sort by descending growth
      .slice(0, 250); // Limit for performance

    // --- End of change ---

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
    let priceChangePercent = 0; // For reporting, shows change at signal moment

    if (!symbol) {
      console.log(`🔍 Resolved tokens: ${resolvedTickerList.length}`);
      console.log(
        "🔍 No active position. Searching for a short entry (based on highest growth)..."
      );

      // --- Changed: Select token based on growth ---
      const tokenToConsider = resolvedTickerList[0]; // Token with highest growth

      // Check if growth is high enough and exceeds threshold
      if (
        !tokenToConsider ||
        tokenToConsider.growthPercent < minGrowthPercent
      ) {
        // Use minGrowthPercent
        console.log(
          `No suitable token found based on growth threshold. Best candidate ${tokenToConsider?.symbol || "N/A"} grew by ${tokenToConsider?.growthPercent?.toFixed(4) || "N/A"}%, threshold: ${minGrowthPercent}%`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: tokenToConsider?.priceChangePercent ?? 0, // For reporting
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const token = tokenToConsider;
      // --- End of change ---

      // For reporting, use the regular change over the last step (already calculated)
      priceChangePercent = token.priceChangePercent ?? 0;

      const futuresPriceForToken = futuresPriceMap.get(token.symbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${token.symbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: priceChangePercent, // Pass calculated change
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
      // priceChangePercent already calculated above
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
        // --- Changed: Use futures price to check TP/SL ---
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice;
        // priceChangePercent for reporting on open position
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
          const troughPrice = price; // <<<--- Futures price
          const newTrailingStop = troughPrice * (1 + dynamicFactor);

          stopLoss =
            stopLoss !== null
              ? Math.min(stopLoss, newTrailingStop)
              : newTrailingStop;
          shortPrice = troughPrice; // <<<--- Futures price
        }

        // Check for take-profit and stop-loss
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
            price,
            stopLoss,
            takeProfit,
            priceChangePercent, // Display change for reporting
            signal,
            exitReason,
            shortPrice,
            // For debugging
            callCount: currentCall,
          },
          { depth: null, colors: true }
        )
      );
    }

    return {
      symbol,
      price,
      priceChangePercent, // Return change for reporting
      signal,
      stopLoss,
      takeProfit,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
