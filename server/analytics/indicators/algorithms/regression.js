import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
  getMarketGrowLevel,
} from "../../../api/binance/info.js";
import { evaluateStrategy } from "../backtest.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS);

function linearRegression(prices) {
  const n = prices.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * prices[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return x.map((xi) => slope * xi + intercept);
}

function generateSignals(candlestickData, shortPeriod, longPeriod) {
  const closePrices = candlestickData.map(({ close }) => close);

  const regressionShort = linearRegression(closePrices);
  const regressionLong = linearRegression(closePrices);

  return candlestickData.map((point, index) => {
    if (index < longPeriod) {
      return {
        time: point.time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
      };
    }

    const shortVal = regressionShort[index];
    const longVal = regressionLong[index];

    const isBuy = shortVal > longVal;
    const isSell = shortVal < longVal;
    const trend = isBuy ? "uptrend" : isSell ? "downtrend" : "neutral";

    return {
      time: point.time,
      isBuySignal: isBuy,
      isSellSignal: isSell,
      trend,
    };
  });
}

function optimizeParameters(prices, maxPeriod = 50, step = 2) {
  let bestSharpeRatio = -Infinity;
  let bestProfitFactor = -Infinity;
  let bestMaxDrawdown = Infinity;
  let optimalShortPeriod = 0;
  let optimalLongPeriod = 0;

  for (let shortPeriod = 5; shortPeriod < maxPeriod; shortPeriod += step) {
    for (
      let longPeriod = shortPeriod + 1;
      longPeriod < maxPeriod;
      longPeriod += step
    ) {
      const signals = generateSignals(prices, shortPeriod, longPeriod);
      const { sharpeRatio, maxDrawdown, profitFactor } = evaluateStrategy(
        signals,
        prices
      );

      if (
        sharpeRatio > bestSharpeRatio &&
        maxDrawdown < bestMaxDrawdown &&
        profitFactor > bestProfitFactor
      ) {
        bestSharpeRatio = sharpeRatio;
        bestProfitFactor = profitFactor;
        bestMaxDrawdown = maxDrawdown;
        optimalShortPeriod = shortPeriod;
        optimalLongPeriod = longPeriod;
      }
    }
  }

  return {
    optimalShortPeriod,
    optimalLongPeriod,
    sharpeRatio: bestSharpeRatio,
    maxDrawdown: bestMaxDrawdown,
    profitFactor: bestProfitFactor,
  };
}

export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const tradingTickers = await getTradingTickers();
    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    const priceListData = await getPrevDayData();

    const tickerList = priceListData
      .map(({ symbol, priceChangePercent, lastPrice, volume }) => ({
        primarySymbol: symbol.split(secondarySymbol)[0],
        secondarySymbol,
        tickerName: symbol,
        priceChangePercent: parseFloat(priceChangePercent),
        lastPrice: parseFloat(lastPrice),
        volume,
      }))
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      );

    const buyTicker = tickerList.find(
      ({ primarySymbol, secondarySymbol }) =>
        primarySymbol + secondarySymbol === tickerName
    );

    const buyPrice = parseFloat(buyTicker?.lastPrice);

    const transformedData = candlestickData.map(([time, , , , close]) => ({
      time,
      close,
    }));

    const bestParams = optimizeParameters(transformedData);
    const signals = generateSignals(
      transformedData,
      bestParams.optimalShortPeriod,
      bestParams.optimalLongPeriod
    );

    const currentSignal = signals[signals.length - 1];

    console.log("currentSignal:", currentSignal);

    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      lastCheck.symbol === currentSymbol && currentSignal.isSellSignal;

    const marketAveragePrice = getMarketGrowLevel(tickerList);

    const signalData = {
      sellPrimarySymbol: tickerToSell?.primarySymbol,
      buyPrimarySymbol: buyTicker?.primarySymbol,
      sellTickerName: tickerToSell?.tickerName,
      buyTickerName: buyTicker?.tickerName,
      buyPrice,
      sellPrice,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketAveragePrice,
    };

    console.log("signalData:", signalData);

    return signalData;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error };
  }
}
