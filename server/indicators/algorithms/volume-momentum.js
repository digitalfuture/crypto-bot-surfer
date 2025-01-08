import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
  getMarketAverageOscillator,
} from "../../api/binance/info.js";
import { evaluateStrategy } from "../backtest.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS);

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

    // Transform the candlestick data to extract time, close, and volume
    const transformedData = candlestickData.map(
      ([time, , , , close, volume]) => ({
        time,
        close,
        volume,
      })
    );

    // Generate signals using the transformed data and periods (before optimization)
    const initialSignals = generateSignals(transformedData, periods);

    // Apply strategy evaluation to optimize short and long periods
    const { optimalShortPeriod, optimalLongPeriod } = evaluateStrategy(
      initialSignals, // Initial signals generated
      transformedData // Price data for evaluation
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

    // Calculate the market average price
    const marketAveragePrice = getMarketAverageOscillator(tickerList);

    // Return the result with optimal strategy information
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
