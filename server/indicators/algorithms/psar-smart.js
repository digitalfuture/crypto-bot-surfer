import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
  getMarketAverageOscillator,
} from "../../api/binance/info.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS);
const commissionPercent = parseFloat(process.env.TEST_COMISSION_PERCENT);

function calculatePsar(data) {
  const afStart = 0.02;
  const afStep = 0.02;
  const afMax = 0.2;

  let psar = data[0].low;
  let ep = data[0].high;
  let af = afStart;
  let isUptrend = true;

  const psarSegments = [];
  let currentSegment = [];

  for (let i = 1; i < data.length; i++) {
    const bar = data[i];

    if (isUptrend) {
      psar = psar + af * (ep - psar);
      if (bar.low < psar) {
        if (currentSegment.length > 0) psarSegments.push(currentSegment);
        currentSegment = [];
        isUptrend = false;
        psar = ep;
        ep = bar.low;
        af = afStart;
      }
    } else {
      psar = psar + af * (ep - psar);
      if (bar.high > psar) {
        if (currentSegment.length > 0) psarSegments.push(currentSegment);
        currentSegment = [];
        isUptrend = true;
        psar = ep;
        ep = bar.high;
        af = afStart;
      }
    }

    if (isUptrend && bar.high > ep) {
      ep = bar.high;
      af = Math.min(af + afStep, afMax);
    } else if (!isUptrend && bar.low < ep) {
      ep = bar.low;
      af = Math.min(af + afStep, afMax);
    }

    currentSegment.push({ time: bar.time, value: psar, isUptrend });
  }

  if (currentSegment.length > 0) {
    psarSegments.push(currentSegment);
  }

  return psarSegments;
}

function generateSignals(psarSegments, candlestickData) {
  const closingPrices = candlestickData.map(({ time, close }) => ({
    time,
    close,
  }));

  const signals = [];

  psarSegments.forEach((segment) => {
    segment.forEach(({ time, value: psar, isUptrend }) => {
      const closingPrice = closingPrices.find(
        (price) => price.time === time
      )?.close;

      if (closingPrice !== undefined) {
        const isBuySignal = isUptrend && psar < closingPrice;
        const isSellSignal = !isUptrend && psar > closingPrice;

        signals.push({
          time,
          isBuySignal,
          isSellSignal,
          psar,
          closingPrice,
          trend: isUptrend ? "uptrend" : "downtrend",
        });
      }
    });
  });

  return signals;
}

function calculateVirtualEquity(signals, initialBalance = 100) {
  let equity = initialBalance;
  let position = null;

  const equityHistory = signals.map((signal) => {
    if (signal.isBuySignal && position === null) {
      position = equity / signal.closingPrice;
      equity -= equity * (commissionPercent / 100);
    } else if (signal.isSellSignal && position !== null) {
      equity = position * signal.closingPrice;
      equity -= equity * (commissionPercent / 100);
      position = null;
    }

    return { time: signal.time, equity };
  });

  return equityHistory;
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
      .map(
        ({
          symbol,
          priceChangePercent,
          lastPrice,
          openTime,
          closeTime,
          volume,
        }) => ({
          primarySymbol: symbol.split(secondarySymbol)[0],
          secondarySymbol,
          tickerName: symbol,
          priceChangePercent: parseFloat(priceChangePercent),
          lastPrice: parseFloat(lastPrice),
          openTime,
          closeTime,
          volume,
        })
      )
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
    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;

    const candlestickData = await getCandlestickData({
      tickerName,
      interval,
      periods,
    });

    const transformedData = candlestickData.map(
      ([time, , high, low, close]) => ({
        time,
        high,
        low,
        close,
      })
    );

    const psarSegments = calculatePsar(transformedData);
    const signals = generateSignals(psarSegments, transformedData);

    const equityHistory = calculateVirtualEquity(signals);
    const lastEquity = equityHistory[equityHistory.length - 1]?.equity || 100;

    const isBuySignal =
      currentSymbol === null &&
      signals[signals.length - 1]?.isBuySignal &&
      lastEquity > 101; // Ensure equity is above 1% drop

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;
    const sellCondition1 = lastCheck.symbol === currentSymbol;
    const isSellSignal =
      sellCondition1 &&
      signals[signals.length - 1]?.isSellSignal &&
      lastEquity > 101;

    const marketAveragePrice = getMarketAverageOscillator(tickerList);

    const result = {
      sellPrimarySymbol,
      buyPrimarySymbol,
      sellTickerName,
      buyTickerName,
      buyPrice,
      sellPrice,
      buyTickerPriceChangePercent,
      sellTickerPriceChangePercent,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketAveragePrice,
      equityHistory,
    };

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
