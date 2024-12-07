import {
  getPrevDayData,
  getTradingTickers,
  getLastPrice,
  getCandlestickData,
} from "../api/binance/info.js";
import { psar } from "indicatorts";

const buyTicker = process.env.PRIMARY_SYMBOL + process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const periods = process.env.BACKTEST_PERIODS;

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

    const buyPrice = await getLastPrice(buyTicker);

    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;

    //
    // Buy signal
    const rawData = await getCandlestickData({
      tickerName: buyTicker,
      interval,
      periods,
    });

    const transformedData = rawData.reduce(
      (acc, [, , high, low, close]) => {
        acc.highs.push(high);
        acc.lows.push(low);
        acc.closings.push(close);
        return acc;
      },
      { highs: [], lows: [], closings: [] }
    );

    const { highs, lows, closings } = transformedData;

    const defaultConfig = { step: 0.02, max: 0.2 };

    const { trends, psarResult } = psar(highs, lows, closings, defaultConfig);

    const generateSignals = (psarResult, trends, closings) => {
      const signals = psarResult.map((psar, index) => {
        const isUptrend = trends[index] === "uptrend";
        const isDowntrend = trends[index] === "downtrend";
        const closingPrice = closings[index];

        const isBuySignal = psar < closingPrice && isUptrend;
        const isSellSignal = psar > closingPrice && isDowntrend;

        return {
          isBuySignal,
          isSellSignal,
          psar,
          closingPrice,
          trend: trends[index],
        };
      });

      return signals;
    };

    const signals = generateSignals(psarResult, trends, closings);

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
    const sellPrice = parseFloat(tickerToSell?.lastPrice);
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
