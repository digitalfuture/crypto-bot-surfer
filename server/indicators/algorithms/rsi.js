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

// Function to calculate RSI (Relative Strength Index)
function calculateRSI(candlestickData, period) {
  const rsi = [];
  let gain = 0;
  let loss = 0;

  // Calculate the initial average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = candlestickData[i].close - candlestickData[i - 1].close;
    if (change >= 0) {
      gain += change;
    } else {
      loss -= change;
    }
  }

  gain /= period;
  loss /= period;

  // Calculate the first RSI value
  rsi.push(100 - 100 / (1 + gain / loss));

  // Calculate the RSI for the rest of the data
  for (let i = period + 1; i < candlestickData.length; i++) {
    const change = candlestickData[i].close - candlestickData[i - 1].close;
    if (change >= 0) {
      gain = (gain * (period - 1) + change) / period;
      loss = (loss * (period - 1)) / period;
    } else {
      loss = (loss * (period - 1) - change) / period;
      gain = (gain * (period - 1)) / period;
    }

    const rs = gain / loss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

// Function to generate signals based on RSI
function generateSignals(candlestickData, shortPeriod, longPeriod) {
  const rsiShort = calculateRSI(candlestickData, shortPeriod);
  const rsiLong = calculateRSI(candlestickData, longPeriod);

  return candlestickData.map(({ time }, index) => {
    if (index < longPeriod) {
      // No signals for the first "longPeriod" candles (RSI data is not available yet)
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
        rsiShort: rsiShort[index],
        rsiLong: rsiLong[index],
      };
    }

    // Generate buy and sell signals based on RSI values
    const isBuySignal = rsiShort[index] < 30 && rsiLong[index] < 30; // Buy when both RSI values are below 30 (oversold)
    const isSellSignal = rsiShort[index] > 70 && rsiLong[index] > 70; // Sell when both RSI values are above 70 (overbought)
    const trend = isBuySignal
      ? "uptrend"
      : isSellSignal
        ? "downtrend"
        : "neutral";

    return {
      time,
      isBuySignal,
      isSellSignal,
      trend,
      rsiShort: rsiShort[index],
      rsiLong: rsiLong[index],
    };
  });
}

// Function to get trade signals and apply strategy evaluation
export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    // Get the current BTC/USDT price for market calculations
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    // Fetch price and volume data for the previous day
    const priceListData = await getPrevDayData();

    // Fetch the list of active trading tickers
    const tradingTickers = await getTradingTickers();

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

    // Get candlestick data for the specified ticker
    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    // Transform the candlestick data to extract time, close price, and volume
    const transformedData = candlestickData.map(
      ([time, , , , close, volume]) => ({
        time,
        close,
        volume,
      })
    );

    // Define short and long periods for RSI
    const shortPeriod = 14; // Short period for RSI
    const longPeriod = 50; // Long period for RSI

    // Generate initial signals using the defined periods
    const initialSignals = generateSignals(
      transformedData,
      shortPeriod,
      longPeriod
    );

    // Apply strategy evaluation to find optimal short and long periods for RSI
    const { optimalShortPeriod, optimalLongPeriod } = evaluateStrategy(
      transformedData,
      initialSignals
    );

    // Generate trading signals using the optimized RSI periods
    const optimalSignals = generateSignals(
      transformedData,
      optimalShortPeriod,
      optimalLongPeriod
    );

    // Get the most recent signal
    const currentSignal = optimalSignals[optimalSignals.length - 1];

    // Check if the current signal is a buy signal
    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    // Find the ticker to sell based on the current symbol
    const tickerToSell = priceListData.find(
      ({ symbol }) => symbol === currentSymbol + secondarySymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      lastCheck.symbol === currentSymbol && currentSignal.isSellSignal;

    // Calculate the average market price for all tickers
    const marketAveragePrice = priceListData
      .filter(({ symbol }) => tradingTickers.includes(symbol))
      .reduce((sum, { lastPrice }, index, array) => {
        sum = sum + parseFloat(lastPrice);

        if (index === array.length - 1) {
          return (sum - btcUsdtPrice) / array.length;
        } else {
          return sum;
        }
      }, 0);

    // Return the result including the optimal strategy information
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
    // Throw an error with additional context if something goes wrong
    throw { type: "Get Trade Signals Error", ...error };
  }
}
