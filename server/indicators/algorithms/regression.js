import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
  getMarketAverage,
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

  // Loop over possible periods for short and long timeframes
  for (let shortPeriod = 5; shortPeriod < maxPeriod; shortPeriod++) {
    for (
      let longPeriod = shortPeriod + 1;
      longPeriod < maxPeriod;
      longPeriod++
    ) {
      // Generate signals based on current periods
      const signals = generateSignals(prices, shortPeriod, longPeriod);

      // Use evaluateStrategy to calculate strategy metrics
      const { sharpeRatio, maxDrawdown, profitFactor } = evaluateStrategy(
        signals, // Signals generated based on the periods
        prices // Historical price data
      );

      // If the current combination of periods gives better results, update the best parameters
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

  // Return the optimal parameters and performance metrics
  return {
    optimalShortPeriod,
    optimalLongPeriod,
    sharpeRatio: bestSharpeRatio,
    maxDrawdown: bestMaxDrawdown,
    profitFactor: bestProfitFactor,
  };
}

function generateSignals(candlestickData, shortPeriod, longPeriod) {
  // Extract close prices from candlestick data
  const closePrices = candlestickData.map(({ close }) => close);

  // Perform linear regression for short and long periods
  const regressionShort = linearRegression(closePrices.slice(0, shortPeriod));
  const regressionLong = linearRegression(closePrices.slice(0, longPeriod));

  // Generate buy/sell signals based on the comparison of regression lines
  return candlestickData.map(({ time }, index) => {
    if (index < longPeriod) {
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral", // No signal for the initial period
      };
    }

    // Generate buy/sell signals based on the trend of short vs long regression
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
  const x = Array.from({ length: n }, (_, i) => i); // X-axis values for the regression (0, 1, 2,...)
  const y = prices; // Y-axis values are the close prices

  // Calculate sums for regression formula
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

  // Calculate slope and intercept for linear regression
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Return the regression values for each point in the series
  return x.map((xi) => slope * xi + intercept);
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

    // Filter and process the price data into a suitable format
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

    // Find the ticker that matches the current primary and secondary symbol
    const buyTicker = tickerList.find(
      ({ primarySymbol, secondarySymbol }) =>
        primarySymbol + secondarySymbol === tickerName
    );

    const buyPrice = parseFloat(buyTicker?.lastPrice);

    // Transform candlestick data to match the expected format
    const transformedData = candlestickData.map(([time, , , , close]) => ({
      time,
      close,
    }));

    // Optimize parameters using historical data
    const bestParams = optimizeParameters(transformedData);

    // Generate signals using the optimized short and long periods
    const signals = generateSignals(
      transformedData,
      bestParams.optimalShortPeriod,
      bestParams.optimalLongPeriod
    );

    // Get the most recent signal
    const currentSignal = signals[signals.length - 1];

    // Determine if the current signal is a buy or sell signal
    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    // Find the ticker to sell based on the current symbol
    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      lastCheck.symbol === currentSymbol && currentSignal.isSellSignal;

    // Calculate the average market price for tickers
    const marketAveragePrice = getMarketAverage(tickerList, btcUsdtPrice);

    // Return the trade signal information along with the calculated market price
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
    // Throw an error with additional context if something fails
    throw { type: "Get Trade Signals Error", ...error };
  }
}
