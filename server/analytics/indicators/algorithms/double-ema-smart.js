import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
  getMarketGrowLevel,
} from "../../../api/binance/info.js";

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

function calculateEquitySignals(equityData, shortPeriod, longPeriod) {
  const emaShort = calculateEMA(equityData, shortPeriod);
  const emaLong = calculateEMA(equityData, longPeriod);

  return equityData.map((value, index) => {
    if (index < longPeriod) {
      return false; // No signal for the initial period
    }
    return emaShort[index] > emaLong[index];
  });
}

export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();
    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });
    const tradingTickers = await getTradingTickers();

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

    const signals = generateSignals(transformedData, 10, 50); // Fixed periods for EMA

    const equity = signals.reduce((acc, signal, index) => {
      if (index === 0) return [0];
      const prevEquity = acc[index - 1];
      if (signal.isBuySignal) {
        return [...acc, prevEquity + transformedData[index].close];
      } else if (signal.isSellSignal) {
        return [...acc, prevEquity - transformedData[index].close];
      }
      return [...acc, prevEquity];
    }, []);

    const equitySignals = calculateEquitySignals(equity, 10, 50);

    const isTradingEnabled = equitySignals[equitySignals.length - 1];

    const currentSignal = signals[signals.length - 1];

    const isBuySignal =
      isTradingEnabled && currentSymbol === null && currentSignal.isBuySignal;

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const isSellSignal =
      isTradingEnabled &&
      lastCheck.symbol === currentSymbol &&
      currentSignal.isSellSignal;

    const marketAveragePrice = getMarketGrowLevel(tickerList);

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
