// volatility.js

import {
  getLastPrice,
  getCandlestickData,
  getTradingTickers,
  getMarketGrowLevel,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

let sellPrice = null;
let stopLoss = null;
let takeProfit = null;
let exitReason = null;

const secondarySymbol = process.env.SECONDARY_SYMBOL; // e.g. "USDT"
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
let takeMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
let topIndex = parseInt(process.env.SYSTEM_PARAM_3);
const commissionRate = parseFloat(process.env.TEST_COMISSION_PERCENT) / 100;

let lastPriceSnapshot = {};
let hasPreviousCycleData = false;

export async function getTradeSignals({ currentPrimarySymbol }) {
  try {
    const now = Date.now();
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const tradingTickers = await getTradingTickers();
    const priceListDataFutures = await getPrevDayDataFutures();

    // Map tickers with delta price calculation and filter needed symbols
    const resolvedTickerList = priceListDataFutures
      .map((item) => {
        const { symbol: tickerName, lastPrice, volume } = item;
        const parsedPrice = parseFloat(lastPrice);
        const vol = parseFloat(volume);
        const prevEntry = lastPriceSnapshot[tickerName];
        let delta = null;

        if (prevEntry && prevEntry.price !== undefined) {
          delta = ((parsedPrice - prevEntry.price) / prevEntry.price) * 100;
        }

        lastPriceSnapshot[tickerName] = {
          price: parsedPrice,
          timestamp: now,
        };

        // Extract primarySymbol by removing secondarySymbol suffix
        const primarySymbol = tickerName.replace(secondarySymbol, "");

        return {
          primarySymbol,
          secondarySymbol,
          tickerName,
          priceChangePercent: delta,
          isCalculatedDelta: delta !== null,
          lastPrice: parsedPrice,
          volume: vol,
        };
      })
      // Filters:
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol, secondarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(({ isCalculatedDelta }) => isCalculatedDelta)
      // Sort by volume descending
      .sort((a, b) => b.volume - a.volume);

    const marketOscillatorLevel =
      resolvedTickerList.length > 0
        ? getMarketGrowLevel(resolvedTickerList)
        : 0;

    // Pick top gainer by priceChangePercent from top 100 by volume
    const topGainer = resolvedTickerList
      .slice(0, 100)
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)[topIndex];

    if (!topGainer) {
      return {
        sellPrimarySymbol: null,
        buyPrimarySymbol: null,
        sellTickerName: null,
        buyTickerName: null,
        buyPrice: null,
        sellPrice: null,
        buyTickerPriceChangePercent: 0,
        sellTickerPriceChangePercent: 0,
        isBuySignal: false,
        isSellSignal: false,
        btcUsdtPrice,
        marketOscillatorLevel,
        exitReason: null,
      };
    }

    const candlesticks = await getCandlestickData({
      tickerName: topGainer.tickerName,
      interval,
      periods,
    });

    // Calculate average volatility
    const volatility =
      candlesticks.reduce((acc, [, , high, low, close]) => {
        return acc + Math.abs((high - low) / close);
      }, 0) / candlesticks.length;

    if (!hasPreviousCycleData) hasPreviousCycleData = true;

    let isBuySignal = false;
    let isSellSignal = false;

    exitReason = null;
    let profitPotential = 0;
    let commissionImpact = 0;
    let tickerPriceChangePercent = 0;
    let symbol;
    let parsedPrice;

    if (!currentPrimarySymbol && hasPreviousCycleData) {
      // No active position - signal to open short on topGainer
      symbol = topGainer.primarySymbol;
      parsedPrice = topGainer.lastPrice;
      tickerPriceChangePercent = topGainer.priceChangePercent;

      const targetTake = parsedPrice * (1 - volatility * takeMultiplier);
      profitPotential = (parsedPrice - targetTake) / parsedPrice;
      commissionImpact = 2 * commissionRate;

      if (profitPotential > commissionImpact * 0.25) {
        sellPrice = parsedPrice;
        stopLoss = sellPrice * (1 + volatility * stopMultiplier);
        takeProfit = sellPrice * (1 - volatility * takeMultiplier);
        isSellSignal = true;
      }
    } else if (currentPrimarySymbol) {
      // Active short position on currentPrimarySymbol, check exit conditions
      const currentTicker = resolvedTickerList.find(
        ({ primarySymbol }) => primarySymbol === currentPrimarySymbol
      );

      if (!currentTicker) {
        return {
          sellPrimarySymbol: null,
          buyPrimarySymbol: null,
          sellTickerName: null,
          buyTickerName: null,
          buyPrice: null,
          sellPrice: null,
          buyTickerPriceChangePercent: 0,
          sellTickerPriceChangePercent: 0,
          isBuySignal: false,
          isSellSignal: false,
          btcUsdtPrice,
          marketOscillatorLevel,
          exitReason: "NO_TICKER",
        };
      }

      tickerPriceChangePercent = currentTicker.priceChangePercent;
      symbol = currentTicker.primarySymbol;
      parsedPrice = currentTicker.lastPrice;

      // Adjust trailing stop if price decreases further
      if (parsedPrice < sellPrice) {
        const dynamicFactor = stopMultiplier * volatility * 1.2;
        const troughPrice = parsedPrice;
        const newTrailingStop = troughPrice * (1 + dynamicFactor);
        stopLoss = Math.min(stopLoss, newTrailingStop);
      }

      // Check stop loss or take profit hit
      if (parsedPrice >= stopLoss) {
        isBuySignal = true;
        exitReason = "SL";
      } else if (parsedPrice <= takeProfit) {
        isBuySignal = true;
        exitReason = "TP";
      }

      if (isBuySignal) {
        sellPrice = null;
        stopLoss = null;
        takeProfit = null;
      }
    }

    // Debug logs for development mode
    if (process.env.MODE === "DEVELOPMENT") {
      const debugSymbol = currentPrimarySymbol || symbol;
      // Find full ticker info by primarySymbol or tickerName
      const debugTicker = resolvedTickerList.find(
        (t) => t.primarySymbol === debugSymbol || t.tickerName === debugSymbol
      );

      console.log("======= TRADE DEBUG =======");
      console.log("Symbol:", debugSymbol);
      console.log("Timestamp:", new Date(now).toISOString());
      console.log(
        "Current Price:",
        "" + (isSellSignal ? sellPrice : parsedPrice)
      );
      console.log("Volatility:", volatility?.toFixed(6));
      console.log(
        "Price Change %:",
        debugTicker?.priceChangePercent?.toFixed(4)
      );
      console.log("Volume:", debugTicker?.volume ?? "N/A");
      console.log("Entry Price:", sellPrice);
      console.log("Stop Loss:", stopLoss);
      console.log("Take Profit:", takeProfit);
      console.log("Buy Signal:", isBuySignal);
      console.log("Sell Signal:", isSellSignal);
      console.log("Exit Reason:", exitReason);
      console.log("Profit Potential:", profitPotential?.toFixed(5));
      console.log("Commission Impact:", commissionImpact?.toFixed(5));
      console.log("BTC Price:", btcUsdtPrice);
      console.log("Market Oscillator:", marketOscillatorLevel);
      console.log("===========================\n");
    }

    return {
      sellPrimarySymbol: isSellSignal ? symbol : null,
      buyPrimarySymbol: currentPrimarySymbol || symbol,
      sellTickerName: isSellSignal ? topGainer.tickerName : null,
      buyTickerName: isBuySignal
        ? resolvedTickerList.find(
            (t) => t.primarySymbol === currentPrimarySymbol
          )?.tickerName || null
        : null,
      buyPrice: parsedPrice,
      sellPrice,
      buyTickerPriceChangePercent: tickerPriceChangePercent || 0,
      sellTickerPriceChangePercent: tickerPriceChangePercent || 0,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketOscillatorLevel,
      exitReason,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error };
  }
}
