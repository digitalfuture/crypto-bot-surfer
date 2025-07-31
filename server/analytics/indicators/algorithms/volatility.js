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
const GROWTH_LOOKBACK_CALLS = parseInt(process.env.GROWTH_LOOKBACK_CALLS, 10) || 12;
const STALL_LOOKBACK_CALLS = parseInt(process.env.STALL_LOOKBACK_CALLS, 10) || 2;
const MIN_STALL_DECLINE_PERCENT = parseFloat(process.env.MIN_STALL_DECLINE_PERCENT) || -0.1;
// --- End of additions ---

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

    let { symbol = null, stopLoss = null, shortPrice = null, takeProfit = null } = state;

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
          call: currentCall
        });

        const maxHistoryLength = Math.max(GROWTH_LOOKBACK_CALLS, STALL_LOOKBACK_CALLS) + 5;
        if (priceHistory[itemSymbol].length > maxHistoryLength) {
            priceHistory[itemSymbol] = priceHistory[itemSymbol].slice(-maxHistoryLength);
        }
        // --- End of price history update ---

        // --- Calculate growth over the pump period ---
        let growthPercent = null;
        let pumpHighPrice = null;

        const pumpStartEntryIndex = priceHistory[itemSymbol].findIndex(entry => entry.call === (currentCall - GROWTH_LOOKBACK_CALLS));
        
        if (pumpStartEntryIndex !== -1 && priceHistory[itemSymbol][pumpStartEntryIndex].price > 0) {
            const pumpStartPrice = priceHistory[itemSymbol][pumpStartEntryIndex].price;
            growthPercent = ((currentPrice - pumpStartPrice) / pumpStartPrice) * 100;
            
            let maxPriceInPeriod = pumpStartPrice;
            for (let i = pumpStartEntryIndex; i < priceHistory[itemSymbol].length; i++) {
                const priceInPeriod = priceHistory[itemSymbol][i].price;
                if (priceInPeriod > maxPriceInPeriod) {
                    maxPriceInPeriod = priceInPeriod;
                }
            }
            pumpHighPrice = maxPriceInPeriod;
        }
        // --- End of growth calculation ---

        // --- Calculate recent price change to check for stall/decline ---
        let recentPriceChangePercentFromHigh = null;
        if (pumpHighPrice !== null && pumpHighPrice > 0 && currentPrice !== undefined) {
            recentPriceChangePercentFromHigh = ((currentPrice - pumpHighPrice) / pumpHighPrice) * 100;
        }
        // --- End of recent change calculation ---
        
        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

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
        return isCalculatedGrowth && isCalculatedRecentChange;
      })
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT);

    // Apply "pump and stall" filters
    const pumpAndStallFiltered = rawTickerList.filter(({ growthPercent, recentPriceChangePercentFromHigh }) => {
        const pumpCondition = growthPercent > minGrowthPercent;
        const stallCondition = recentPriceChangePercentFromHigh <= MIN_STALL_DECLINE_PERCENT;
        return pumpCondition && stallCondition;
    });

    // Sort by descending growth (highest growers first)
    const resolvedTickerList = pumpAndStallFiltered
      .sort((a, b) => b.growthPercent - a.growthPercent)
      .slice(0, 5); // Limit to top 5 for logging

    let signal = null;
    let exitReason = null;
    let price = null;
    let priceChangePercent = 0;

    if (!symbol) {
      if (resolvedTickerList.length > 0) {
        const tokenToConsider = resolvedTickerList[0];
        const token = tokenToConsider;
        priceChangePercent = token.recentPriceChangePercentFromHigh ?? 0;

        const futuresPriceForToken = futuresPriceMap.get(token.symbol);
        if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
          console.warn(`Could not get futures price for ${token.symbol}. Skipping signal.`);
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
          console.log(`✅ SELL: ${symbol} | Growth: ${token.growthPercent?.toFixed(2)}% | Stall: ${token.recentPriceChangePercentFromHigh?.toFixed(2)}%`);
        }
      } else {
        if (process.env.MODE === "DEVELOPMENT") {
          console.log("🔍 No suitable token found for short entry.");
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
    } else {
      // Logic for open position
      let currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      const currentFuturesPrice = futuresPriceMap.get(symbol);
      if (currentFuturesPrice === undefined || currentFuturesPrice <= 0) {
        console.warn(`Could not get futures price for open position ${symbol}.`);
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
          priceChangePercent = 0;
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
        if (process.env.MODE === "DEVELOPMENT") {
            console.log(`❌ BUY (POSITION_NOT_FOUND) for ${symbol}`);
        }
      } else {
        price = currentFuturesPrice !== undefined && currentFuturesPrice > 0 ? currentFuturesPrice : currentTicker.lastPrice;
        priceChangePercent = currentTicker.priceChangePercent ?? 0;

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
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`✅ BUY (TP) for ${symbol} at price ${price.toFixed(8)}. TP was ${takeProfit.toFixed(8)}`);
          }
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`❌ BUY (SL) for ${symbol} at price ${price.toFixed(8)}. SL was ${stopLoss.toFixed(8)}`);
          }
        } else if (process.env.MODE === "DEVELOPMENT") {
            // Minimal log for holding
            console.log(`📈 Holding position on ${symbol}.`);
        }
      }
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