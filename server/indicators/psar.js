import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
} from "../api/binance/info.js";

const tickerName = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const periods = process.env.BACKTEST_PERIODS;

function calculatePsar(data) {
  const afStart = 0.02; // Initial acceleration factor
  const afStep = 0.02; // Increment for acceleration
  const afMax = 0.2; // Maximum acceleration factor

  let psar = data[0].low; // Start with the first low
  let ep = data[0].high; // Extreme point (initial high)
  let af = afStart; // Initial acceleration factor
  let isUptrend = true; // Start with an uptrend

  const psarSegments = [];
  let currentSegment = [];

  for (let i = 1; i < data.length; i++) {
    const bar = data[i];

    if (isUptrend) {
      psar = psar + af * (ep - psar); // Calculate next PSAR for uptrend
      if (bar.low < psar) {
        // Switch to downtrend
        if (currentSegment.length > 0) psarSegments.push(currentSegment);
        currentSegment = [];
        isUptrend = false;
        psar = ep; // Reset PSAR to previous extreme point
        ep = bar.low; // New extreme point
        af = afStart; // Reset acceleration factor
      }
    } else {
      psar = psar + af * (ep - psar); // Calculate next PSAR for downtrend
      if (bar.high > psar) {
        // Switch to uptrend
        if (currentSegment.length > 0) psarSegments.push(currentSegment);
        currentSegment = [];
        isUptrend = true;
        psar = ep; // Reset PSAR to previous extreme point
        ep = bar.high; // New extreme point
        af = afStart; // Reset acceleration factor
      }
    }

    // Update extreme point and acceleration factor
    if (isUptrend && bar.high > ep) {
      ep = bar.high; // Adjust extreme point to new high
      af = Math.min(af + afStep, afMax); // Increase acceleration factor
    } else if (!isUptrend && bar.low < ep) {
      ep = bar.low; // Adjust extreme point to new low
      af = Math.min(af + afStep, afMax); // Increase acceleration factor
    }

    // Add PSAR point to the current segment
    currentSegment.push({ time: bar.time, value: psar, isUptrend });
  }

  // Push the last segment if it has data
  if (currentSegment.length > 0) {
    psarSegments.push(currentSegment);
  }

  return psarSegments;
}

// Генерация сигналов на основе PSAR
function generateSignals(psarSegments, candlestickData) {
  // Соответствуем цены закрытия с временной меткой
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
        // Логика сигналов
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

export async function getTradeSignals({
  currentSymbol,
  lastCheck,
  secondarySymbol,
}) {
  try {
    // console.info("\nlastCheck:", lastCheck);
    // console.info("lastTrade:", lastTrade);

    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const priceListData = await getPrevDayData();

    const tradingTickers = await getTradingTickers();
    // console.info("tradingTickers:", tradingTickers);

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

    //
    // Buy signal
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
    // Рассчитываем PSAR сегменты с новыми параметрами
    const psarSegments = calculatePsar(transformedData);
    // console.log("psarSegments", psarSegments);

    // Генерация сигналов
    const signals = generateSignals(psarSegments, transformedData);

    const currentSignal = signals[signals.length - 1];
    // console.log("Current Signal:", currentSignal);

    const isBuySignal = currentSymbol === null && currentSignal.isBuySignal;

    // console.log("buyTicker:", buyTicker);
    // console.log("changePercent:", buyTicker.priceChangePercent);

    //
    // Sell signal
    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;
    const sellCondition1 = lastCheck.symbol === currentSymbol;
    const isSellSignal = sellCondition1 && currentSignal.isSellSignal;

    // Market average
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

    //
    // Result
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
    };

    // console.info("\nCheck signals result:", {
    //   buySignal: {
    //     buyPrimarySymbol,
    //     buyTickerName,
    //     buyPrice,
    //     buyTickerPriceChangePercent,
    //     isBuySignal,
    //   },
    //   sellSignal: {
    //     sellPrimarySymbol,
    //     sellTickerName,
    //     sellPrice,
    //     sellTickerPriceChangePercent,
    //     isSellSignal,
    //   },
    // });

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
