import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";
import { getLastPrice } from "../../api/binance/info.js";

let lastBtcUsdtPrice = null;

export async function getTradeSignals({
  secondarySymbol,
  currentSymbol,
  lastTrade,
  lastCheck,
  usedSymbols,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    if (!lastBtcUsdtPrice) lastBtcUsdtPrice = btcUsdtPrice;

    console.info("usedSymbols:", usedSymbols);
    console.info("lastTrade:", lastTrade);

    const tradingTickers = await getTradingTickers();
    // console.info("tradingTickers:", tradingTickers);

    const topListData = await getPrevDayData();
    // console.info("topListData:", topListData);

    const mappedList = topListData.map(
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

    const tickerListToBuy = mappedList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade.symbol)
      .filter(({ primarySymbol }) => !usedSymbols.includes(primarySymbol))
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    //
    // Buy signal
    const isBtcFalling = lastBtcUsdtPrice > btcUsdtPrice;
    const tickerToBuy = tickerListToBuy[tickerListToBuy.length - 1];
    const buyPrimarySymbol = tickerToBuy.primarySymbol;
    const buyTickerName = tickerToBuy.tickerName;
    const buyPrice = tickerToBuy && parseFloat(tickerToBuy.lastPrice);
    const buyTickerPriceChangePercent = tickerToBuy.priceChangePercent;
    const buyCondition1 = !currentSymbol;
    const buyCondition2 = !isBtcFalling;
    const isBuySignal = buyCondition1 && buyCondition2;

    console.info("lastBtcUsdtPrice:", lastBtcUsdtPrice);
    console.info("btcUsdtPrice:", btcUsdtPrice);
    console.info("isBtcFalling:", isBtcFalling);

    lastBtcUsdtPrice = btcUsdtPrice;

    // console.info(
    //   "\nbtcUsdtTicker.priceChangePercent:",
    //   btcUsdtTicker.priceChangePercent
    // );
    // console.info("isBtcFalling:", btcUsdtTicker.priceChangePercent > 0);

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
