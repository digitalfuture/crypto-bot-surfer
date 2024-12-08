import { getPrevDayData, getTradingTickers } from "../api/binance/info.js";
import { getLastPrice } from "..//api/binance/info.js";

const changePercent = parseFloat(process.env.INDICATOR_CHANGE_PERCENT);

export async function getTradeSignals({
  secondarySymbol,
  currentSymbol,
  lastTrade,
  lastCheck,
}) {
  try {
    // console.info("\nlastCheck:", lastCheck);
    // console.info("lastTrade:", lastTrade);

    // BTC / USDT
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

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

    const buyTickerList = tickerList
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade.symbol)
      .filter(({ primarySymbol }) => primarySymbol !== currentSymbol)
      .filter(({ priceChangePercent }) => priceChangePercent > changePercent)
      .sort((a, b) => a.volume - b.volume)
      .slice(-10)
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    //
    // Buy signal
    const buyTicker =
      buyTickerList[Math.floor(Math.random() * buyTickerList.length)];
    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyPrice = parseFloat(buyTicker?.lastPrice);
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;
    const buyCondition = currentSymbol === null && buyTicker;
    const isBuySignal = buyCondition;

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
    const sellCondition2 = sellPrice < lastCheck.price;
    const isSellSignal = sellCondition1 && sellCondition2;

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
