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
      // No signals to generate for the first "longPeriod" candles
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
        rsiShort: rsiShort[index],
        rsiLong: rsiLong[index],
      };
    }

    // Generate buy/sell signals based on the RSI
    const isBuySignal = rsiShort[index] < 30 && rsiLong[index] < 30; // Buy when RSI is below 30 (oversold)
    const isSellSignal = rsiShort[index] > 70 && rsiLong[index] > 70; // Sell when RSI is above 70 (overbought)
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
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();
    const tradingTickers = await getTradingTickers();

    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    // Transform the candlestick data to extract time, close, and volume
    const transformedData = candlestickData.map(
      ([time, , , , close, volume]) => ({
        time,
        close,
        volume,
      })
    );

    // Apply strategy evaluation to optimize short and long periods for RSI
    const { optimalShortPeriod, optimalLongPeriod } = evaluateStrategy(
      transformedData,
      50 // Set maxPeriod for optimization
    );

    // Generate signals using the optimized periods for RSI
    const optimalSignals = generateSignals(
      transformedData,
      optimalShortPeriod,
      optimalLongPeriod
    );

    const currentSignal = optimalSignals[optimalSignals.length - 1];

    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    const tickerToSell = priceListData.find(
      ({ symbol }) => symbol === currentSymbol + secondarySymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      lastCheck.symbol === currentSymbol && currentSignal.isSellSignal;

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

    // Return the result with optimal strategy information
    return {
      sellPrimarySymbol: tickerToSell?.primarySymbol,
      buyPrimarySymbol: tickerToSell?.primarySymbol,
      sellTickerName: tickerToSell?.tickerName,
      buyTickerName: tickerToSell?.tickerName,
      buyPrice: parseFloat(tickerToSell?.lastPrice),
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
