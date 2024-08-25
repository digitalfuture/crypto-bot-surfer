import signals from "../../_signals/index.json" assert { type: "json" };
import { getPrevDayData, getTradingTickers } from "../api/binance/info.js";
import { getLastPrice } from "../api/binance/info.js";

const primarySymbol = process.env.PRIMARY_SYMBOL;
const secondarySymbol = process.env.SECONDARY_SYMBOL;

export async function getTradeSignals({ currentSymbol }) {
  try {
    // File structure
    //
    // [
    //   {
    //     "datetime": "2023-05-07T05:12:10.156Z,28842.02",
    //     "ticker": "BTCUSDT",
    //     "signal": "BUY",
    //     "price": "50000"
    //   }
    // ]

    const { ticker, signal } = signals.reverse()[0];
    const tickerName = primarySymbol + secondarySymbol;

    console.info("SIGNAL from file:", signal);
    console.info("TICKER from file:", ticker);
    console.info("");
    console.info("TRADING TICKER:", tickerName);

    const isTradingTockerMatch = ticker !== tickerName;

    if (isTradingTockerMatch) {
      console.log(
        `Trading ticker ${tickerName} does not match with Signal ticker ${ticker}`
      );
    }

    // console.info("\nlastCheck:", lastCheck);
    // console.info("lastTrade:", lastTrade);

    const tradingTickers = await getTradingTickers();
    // console.info("tradingTickers:", tradingTickers);

    const priceListData = await getPrevDayData();
    // console.info("priceListData:", priceListData);

    const tickerList = priceListData
      .map(
        ({
          symbol,
          priceChangePercent,
          lastPrice,
          openTime,
          closeTime,
          ...others
        }) => ({
          primarySymbol: symbol.split(secondarySymbol)[0],
          secondarySymbol,
          tickerName: symbol,
          priceChangePercent: parseFloat(priceChangePercent),
          lastPrice: parseFloat(lastPrice),
          openTime,
          closeTime,
          ...others,
        })
      )
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"));

    //
    // Buy signal
    const tickerToBuy = tickerList.find(
      ({ primarySymbol }) => primarySymbol === process.env.PRIMARY_SYMBOL
    );
    const buyPrimarySymbol = tickerToBuy.primarySymbol;
    const buyTickerName = tickerToBuy.tickerName;
    const buyPrice = tickerToBuy && parseFloat(tickerToBuy.lastPrice);
    const buyTickerPriceChangePercent = tickerToBuy.priceChangePercent;
    const isBuySignal = signal === "BUY" && isTradingTockerMatch;

    //
    // Sell signal
    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === primarySymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = tickerToSell && parseFloat(tickerToSell.lastPrice);
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;
    const isSellSignal = signal === "SELL" && isTradingTockerMatch;

    // BTC / USDT
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    // Market average
    const marketAveragePrice = tickerList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
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
