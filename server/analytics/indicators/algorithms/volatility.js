import {
  getLastPrice,
  getCandlestickData,
  getPrevDayData,
  getTradingTickers,
  getMarketGrowLevel,
} from "../../../api/binance/info.js";

let entryPrice = null;
let stopLoss = null;
let takeProfit = null;
let exitReason = null;
let tradeHistory = [];

let previousStopLoss = null;
let flatStopCounter = 0;

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
let baseStopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
let baseTakeMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
let topTokenToBuy = parseInt(process.env.SYSTEM_PARAM_3);
const commissionRate = parseFloat(process.env.TEST_COMISSION_PERCENT) / 100;

let lastPriceSnapshot = {};
let hasPreviousCycleData = false;

export async function getTradeSignals({ currentSymbol }) {
  try {
    const now = Date.now();
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();
    const tradingTickers = await getTradingTickers();

    let resolvedTickerList = priceListData
      .map((item) => {
        const { symbol: s, lastPrice, volume } = item;
        const parsed = parseFloat(lastPrice);
        const vol = parseFloat(volume);
        const prevEntry = lastPriceSnapshot[s];
        let delta = null;
        if (prevEntry && prevEntry.price !== undefined) {
          delta = ((parsed - prevEntry.price) / prevEntry.price) * 100;
        }
        lastPriceSnapshot[s] = {
          price: parsed,
          timestamp: now,
        };
        return {
          primarySymbol: s.replace(secondarySymbol, ""),
          secondarySymbol,
          tickerName: s,
          priceChangePercent: delta,
          isCalculatedDelta: delta !== null,
          lastPrice: parsed,
          volume: vol,
        };
      })
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(
        ({ isCalculatedDelta, volume }) => isCalculatedDelta && volume > 100000
      );
    // .sort((a, b) => b.volume - a.volume)
    // .slice(0, 100);

    const marketAveragePrice =
      resolvedTickerList.length > 0
        ? getMarketGrowLevel(resolvedTickerList)
        : 0;

    const topGainer = resolvedTickerList.sort(
      (a, b) => b.priceChangePercent - a.priceChangePercent
    )[topTokenToBuy];

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
        marketAveragePrice,
        exitReason: null,
      };
    }

    const symbol = topGainer.tickerName;
    const topGainerPrice = topGainer.lastPrice;

    const candlesticks = await getCandlestickData({
      tickerName: symbol,
      interval,
      periods,
    });

    const volatility =
      candlesticks.reduce((acc, [, , high, low, close]) => {
        return acc + Math.abs((high - low) / close);
      }, 0) / candlesticks.length;

    if (!hasPreviousCycleData) hasPreviousCycleData = true;

    const recentTrades = tradeHistory.slice(-3);
    const lossCount = recentTrades.filter((t) => t < 0).length;
    let stopMultiplier = baseStopMultiplier;
    let takeMultiplier = baseTakeMultiplier;
    if (lossCount >= 2) {
      stopMultiplier *= 0.8;
      takeMultiplier *= 1.2;
    }

    let isBuySignal = false;
    let isSellSignal = false;
    let buyPrice = null;
    let sellPrice = null;
    exitReason = null;
    let profitPotential = 0;
    let commissionImpact = 0;
    let sellTickerPriceChangePercent = null;

    let tickerToSell = null;
    let parsedPrice = topGainerPrice;

    if (!currentSymbol && hasPreviousCycleData) {
      const targetTake = parsedPrice * (1 + volatility * takeMultiplier);
      profitPotential = (targetTake - parsedPrice) / parsedPrice;
      commissionImpact = 2 * commissionRate;

      if (profitPotential > commissionImpact * 0.25) {
        entryPrice = parsedPrice;
        stopLoss = entryPrice * (1 - volatility * stopMultiplier);
        takeProfit = entryPrice * (1 + volatility * takeMultiplier);
        isBuySignal = true;
        buyPrice = entryPrice;
      }
    } else if (currentSymbol) {
      tickerToSell = resolvedTickerList.find(
        ({ primarySymbol }) => primarySymbol === currentSymbol
      );
      if (!tickerToSell) return {};

      parsedPrice = tickerToSell.lastPrice;

      if (parsedPrice > entryPrice) {
        const peakPrice = parsedPrice;
        const dynamicFactor = stopMultiplier * volatility * 1.2;
        const newTrailingStop = peakPrice * (1 - dynamicFactor);
        stopLoss = Math.max(stopLoss, newTrailingStop);

        const stopMove = stopLoss - (previousStopLoss ?? 0);
        previousStopLoss = stopLoss;

        const flatThreshold = entryPrice * 0.0003;
        if (stopMove < flatThreshold) {
          flatStopCounter++;
        } else {
          flatStopCounter = 0;
        }

        if (flatStopCounter >= 3) {
          isSellSignal = true;
          sellPrice = parsedPrice;
          exitReason = "FLAT";
        }
      }

      if (parsedPrice <= stopLoss) {
        isSellSignal = true;
        sellPrice = parsedPrice;
        exitReason = "SL";
      }

      if (isSellSignal) {
        const grossChange = (sellPrice - entryPrice) / entryPrice;
        const netChange = grossChange - 2 * commissionRate;
        tradeHistory.push(netChange * 100);
        sellTickerPriceChangePercent = netChange * 100;

        entryPrice = null;
        stopLoss = null;
        takeProfit = null;
        previousStopLoss = null;
        flatStopCounter = 0;
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
      const debugSymbol = isBuySignal
        ? symbol
        : tickerToSell?.tickerName || currentSymbol || "N/A";

      const activePrice = isBuySignal
        ? parsedPrice
        : tickerToSell?.lastPrice || parsedPrice;

      console.log("======= TRADE DEBUG =======");
      console.log("Symbol:", debugSymbol);
      console.log("Timestamp:", new Date(now).toISOString());
      console.log("Current Price:", activePrice);
      console.log("Volatility:", volatility.toFixed(6));
      console.log("Price Change %:", topGainer.priceChangePercent?.toFixed(4));
      console.log("Volume:", topGainer.volume);
      console.log("Entry Price:", entryPrice);
      console.log("Stop Loss:", stopLoss);
      console.log(
        "Stop check:",
        `current price ${activePrice} ${activePrice <= stopLoss ? "<=" : ">"} stop ${stopLoss}`
      );
      console.log("Take Profit:", takeProfit);
      console.log("Buy Signal:", isBuySignal);
      console.log("Sell Signal:", isSellSignal);
      console.log("Exit Reason:", exitReason);
      console.log("Profit Potential:", profitPotential.toFixed(5));
      console.log("Commission Impact:", commissionImpact.toFixed(5));
      console.log("BTC Price:", btcUsdtPrice);
      console.log("Market Avg:", marketAveragePrice);
      console.log("===========================\n");
    }

    return {
      sellPrimarySymbol: isSellSignal ? tickerToSell?.primarySymbol : null,
      buyPrimarySymbol: isBuySignal ? topGainer.primarySymbol : null,
      sellTickerName: isSellSignal ? tickerToSell?.tickerName : null,
      buyTickerName: isBuySignal ? topGainer.tickerName : null,
      buyPrice: isBuySignal ? buyPrice : null,
      sellPrice,
      buyTickerPriceChangePercent:
        isBuySignal && topGainer.priceChangePercent !== null
          ? topGainer.priceChangePercent
          : 0,
      sellTickerPriceChangePercent:
        isSellSignal && sellTickerPriceChangePercent !== null
          ? sellTickerPriceChangePercent
          : 0,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketAveragePrice,
      exitReason,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error };
  }
}
