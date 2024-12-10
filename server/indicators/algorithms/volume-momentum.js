import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
} from "../../api/binance/info.js";
import { evaluateStrategy } from "./evaluateStrategy"; // Import the evaluation function

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = process.env.BACKTEST_PERIODS;

// Function to calculate the Volume Momentum
function calculateVolumeMomentum(candlestickData) {
  return candlestickData.map(({ time, close, volume }, index) => {
    if (index === 0) {
      return { time, momentum: 0 }; // No change for the first element
    }

    const prevClose = candlestickData[index - 1].close;
    const prevVolume = candlestickData[index - 1].volume;
    const volumeMomentum = (volume - prevVolume) * (close - prevClose);

    return { time, momentum: volumeMomentum };
  });
}

// Function to generate signals based on Volume Momentum
function generateSignals(candlestickData, shortPeriod, longPeriod) {
  // Calculate the Volume Momentum for the given candlestick data
  const volumeMomentumData = calculateVolumeMomentum(candlestickData);

  // Generate signals based on the Volume Momentum and the provided periods
  return volumeMomentumData.map(({ time, momentum }, index) => {
    if (index < longPeriod) {
      // No signals to generate for the first "longPeriod" candles
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
        momentum,
      };
    }

    // Generate buy/sell signals based on the momentum of the volume
    const isBuySignal = momentum > 0; // Buy when momentum is positive
    const isSellSignal = momentum < 0; // Sell when momentum is negative
    const trend = isBuySignal
      ? "uptrend"
      : isSellSignal
      ? "downtrend"
      : "neutral";

    return { time, isBuySignal, isSellSignal, trend, momentum };
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

    // Apply strategy evaluation to optimize short and long periods
    const {
      optimalShortPeriod,
      optimalLongPeriod,
      sharpeRatio,
      maxDrawdown,
      profitFactor,
    } = evaluateStrategy(
      transformedData,
      50 // Set maxPeriod for optimization
    );

    // Generate signals using the optimized periods
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
      optimalShortPeriod, // Return optimized short period
      optimalLongPeriod, // Return optimized long period
      sharpeRatio, // Return Sharpe ratio
      maxDrawdown, // Return max drawdown
      profitFactor, // Return profit factor
    };
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error };
  }
}
