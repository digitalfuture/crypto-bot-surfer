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

function calculateEMA(prices, period) {
  const ema = [];
  const multiplier = 2 / (period + 1);

  // Calculate the initial EMA (Simple Moving Average) for the first 'period' values
  let previousEma =
    prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  // Calculate the rest of the EMA values using the multiplier
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      ema.push(NaN); // For the first 'period' values, EMA is unavailable
    } else {
      // Apply the EMA formula
      previousEma = (prices[i] - previousEma) * multiplier + previousEma;
      ema.push(previousEma);
    }
  }

  return ema;
}

// Dynamic optimization for EMA strategy
function optimizeEMAParameters(prices, maxPeriod = 50) {
  let bestSharpeRatio = -Infinity;
  let bestProfitFactor = -Infinity;
  let bestMaxDrawdown = Infinity;
  let optimalShortPeriod = 0;
  let optimalLongPeriod = 0;

  // Try different combinations of short and long periods to find the best
  for (let shortPeriod = 5; shortPeriod < maxPeriod; shortPeriod++) {
    for (
      let longPeriod = shortPeriod + 1;
      longPeriod < maxPeriod;
      longPeriod++
    ) {
      // Generate buy/sell signals based on the current short and long periods
      const signals = generateSignals(prices, shortPeriod, longPeriod);

      // Evaluate the strategy using the generated signals
      const { sharpeRatio, maxDrawdown, profitFactor } = evaluateStrategy(
        signals, // Signals generated using the current periods
        prices // Historical price data
      );

      // Update the best parameters if the current combination gives better results
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

  // Return the optimal short and long periods along with performance metrics
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

  // Calculate short and long EMAs
  const emaShort = calculateEMA(closePrices, shortPeriod);
  const emaLong = calculateEMA(closePrices, longPeriod);

  // Generate buy/sell signals based on the EMA values
  return candlestickData.map(({ time }, index) => {
    if (index < longPeriod) {
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral", // No signal for the initial period
      };
    }

    // Determine if the current signal is a buy or sell based on EMA crossover
    const isBuySignal = emaShort[index] > emaLong[index];
    const isSellSignal = emaShort[index] < emaLong[index];
    const trend = isBuySignal
      ? "uptrend"
      : isSellSignal
        ? "downtrend"
        : "neutral";

    return { time, isBuySignal, isSellSignal, trend };
  });
}

export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    // Get the current price of BTC/USDT to calculate the market price
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    // Fetch previous day's price and volume data
    const priceListData = await getPrevDayData();

    // Get candlestick data for the selected ticker
    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    // Get the list of active trading tickers
    const tradingTickers = await getTradingTickers();

    // Filter and process the price data into a suitable format for further analysis
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

    // Find the ticker that matches the primary and secondary symbol for buying
    const buyTicker = tickerList.find(
      ({ primarySymbol, secondarySymbol }) =>
        primarySymbol + secondarySymbol === tickerName
    );

    const buyPrice = parseFloat(buyTicker?.lastPrice);

    // Transform candlestick data into the necessary format for the strategy
    const transformedData = candlestickData.map(([time, , , , close]) => ({
      time,
      close,
    }));

    // Optimize EMA parameters dynamically based on historical data
    const { optimalShortPeriod, optimalLongPeriod } =
      optimizeEMAParameters(transformedData);

    // Generate trade signals based on the optimized EMA periods
    const signals = generateSignals(
      transformedData,
      optimalShortPeriod,
      optimalLongPeriod
    );

    // Get the most recent signal
    const currentSignal = signals[signals.length - 1];

    // Check if the current signal is a buy signal
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

    // Return the trade signal data along with calculated prices
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
