import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
} from "../../api/binance/info.js";
import { evaluateStrategy } from "../backtest.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS);

function optimizeParameters(prices, maxPeriod = 50) {
  let bestSharpeRatio = -Infinity;
  let bestProfitFactor = -Infinity;
  let bestMaxDrawdown = Infinity;
  let optimalShortPeriod = 0;
  let optimalLongPeriod = 0;

  for (let shortPeriod = 5; shortPeriod < maxPeriod; shortPeriod++) {
    for (
      let longPeriod = shortPeriod + 1;
      longPeriod < maxPeriod;
      longPeriod++
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

function generateSignals(candlestickData, shortPeriod, longPeriod) {
  const closePrices = candlestickData.map(({ close }) => close);

  const regressionShort = linearRegression(closePrices.slice(0, shortPeriod));
  const regressionLong = linearRegression(closePrices.slice(0, longPeriod));

  return candlestickData.map(({ time }, index) => {
    if (index < longPeriod) {
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
      };
    }

    const isBuySignal = regressionShort[index] > regressionLong[index];
    const isSellSignal = regressionShort[index] < regressionLong[index];
    const trend = isBuySignal
      ? "uptrend"
      : isSellSignal
      ? "downtrend"
      : "neutral";

    return { time, isBuySignal, isSellSignal, trend };
  });
}

function linearRegression(prices) {
  const n = prices.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = prices;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return x.map((xi) => slope * xi + intercept);
}

export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();
    const tradingTickers = await getTradingTickers();

    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

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

    // Dynamic optimization for regression parameters
    const metricFunction = (signals) => {
      // Example: Calculate profit/drawdown ratio from signals
      const profit = signals.filter((s) => s.isBuySignal).length;
      const drawdown = signals.filter((s) => s.isSellSignal).length;
      return profit / (drawdown || 1);
    };

    const bestParams = optimizeParameters(transformedData, metricFunction);

    const signals = generateSignals(
      transformedData,
      bestParams.shortPeriod,
      bestParams.longPeriod
    );

    const currentSignal = signals[signals.length - 1];

    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      lastCheck.symbol === currentSymbol && currentSignal.isSellSignal;

    const marketAveragePrice = tickerList
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .reduce((sum, { lastPrice }, index, array) => {
        sum = sum + parseFloat(lastPrice);

        if (index === array.length - 1) {
          return (sum - btcUsdtPrice) / array.length;
        } else {
          return sum;
        }
      }, 0);

    return {
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
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error };
  }
}
