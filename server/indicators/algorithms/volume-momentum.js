import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
} from "../../api/binance/info.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const periods = process.env.BACKTEST_PERIODS;

function calculateEMA(prices, period) {
  const ema = [];
  const multiplier = 2 / (period + 1);

  let previousEma =
    prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      ema.push(NaN);
    } else {
      previousEma = (prices[i] - previousEma) * multiplier + previousEma;
      ema.push(previousEma);
    }
  }

  return ema;
}

function generateSignals(candlestickData, shortPeriod, longPeriod) {
  const closePrices = candlestickData.map(({ close }) => close);

  const emaShort = calculateEMA(closePrices, shortPeriod);
  const emaLong = calculateEMA(closePrices, longPeriod);

  return candlestickData.map(({ time }, index) => {
    if (index < longPeriod) {
      return {
        time,
        isBuySignal: false,
        isSellSignal: false,
        trend: "neutral",
      };
    }

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
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();
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

    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    const transformedData = candlestickData.map(([time, , , , close]) => ({
      time,
      close,
    }));

    const shortPeriod = 9;
    const longPeriod = 21;
    const signals = generateSignals(transformedData, shortPeriod, longPeriod);

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
