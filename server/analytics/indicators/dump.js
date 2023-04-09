import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";
import { getLastPrice } from "../../api/binance/info.js";

const isBtcFilter = JSON.parse(process.env.BTC_FILTER);

let lastBtcUsdtPrice = null;
let lastMarketAveragePrice = null;

export async function getTradeSignals({
  secondarySymbol,
  currentSymbol,
  lastTrade,
  lastCheck,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    if (!lastBtcUsdtPrice) lastBtcUsdtPrice = btcUsdtPrice;

    // console.info("\nlastCheck:", lastCheck);
    // console.info("lastTrade:", lastTrade);

    const tradingTickers = await getTradingTickers();
    // console.info("tradingTickers:", tradingTickers);

    const priceListData = await getPrevDayData();
    // console.info("priceListData:", priceListData);

    const mappedList = priceListData.map(
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
    );

    const filteredListForMarketChange = mappedList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      );

    const tickerListToBuy = mappedList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade.symbol)
      .filter(({ primarySymbol }) => primarySymbol !== currentSymbol)
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    const marketAveragePrice = filteredListForMarketChange.reduce(
      (sum, { lastPrice }, index, array) => {
        sum = sum + parseFloat(lastPrice);

        if (index === array.length - 1) {
          return sum / array.length;
        } else {
          return sum;
        }
      },
      0
    );

    if (!lastMarketAveragePrice) lastMarketAveragePrice = marketAveragePrice;

    const marketPriceChange = marketAveragePrice - lastMarketAveragePrice;
    lastMarketAveragePrice = marketAveragePrice;

    //
    // Buy signal
    const isBtcUp = lastBtcUsdtPrice > btcUsdtPrice;
    const tickerToBuy = tickerListToBuy[tickerListToBuy.length - 1];
    const buyPrimarySymbol = tickerToBuy.primarySymbol;
    const buyTickerName = tickerToBuy.tickerName;
    const buyPrice = tickerToBuy && parseFloat(tickerToBuy.lastPrice);
    const buyTickerPriceChangePercent = tickerToBuy.priceChangePercent;
    const buyCondition1 = !currentSymbol;
    const buyCondition2 = isBtcFilter ? isBtcUp : true;
    const isBuySignal = buyCondition1 && buyCondition2;

    lastBtcUsdtPrice = btcUsdtPrice;

    //
    // Sell signal
    const tickerToSell = mappedList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = tickerToSell && parseFloat(tickerToSell.lastPrice);
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;
    const sellCondition1 = lastCheck.symbol === currentSymbol;
    const sellCondition2 = sellPrice < lastCheck.price;
    const isSellSignal = sellCondition1 && sellCondition2;

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
      marketPriceChange,
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
