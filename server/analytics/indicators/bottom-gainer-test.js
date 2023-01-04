import { getPrevDayData } from "../../api/binance/info.js";

export async function getTradeSignals({
  secondarySymbol,
  currentSymbols,
  minChangePercent,
  lastTrade,
}) {
  try {
    const topListData = await getPrevDayData();
    // console.info("topListData:", topListData);

    const mappedList = topListData.map(
      ({ symbol, priceChangePercent, lastPrice, openTime, closeTime }) => ({
        primarySymbol: symbol.split(secondarySymbol)[0],
        secondarySymbol,
        tickerName: symbol,
        priceChangePercent: parseInt(priceChangePercent),
        lastPrice: parseFloat(lastPrice),
        openTime,
        closeTime,
      })
    );

    const filteredList = mappedList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade.symbol)
      .filter(
        ({ priceChangePercent }) => priceChangePercent >= minChangePercent
      )
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    //
    // Buy signals
    const tickersToBuy = [];

    for (const ticker of filteredList) {
      // console.info("ticker:", ticker);
      // console.info("ticker.primarySymbol:", ticker.primarySymbol);
      // console.info("currentSymbols:", currentSymbols);
      // console.info(`currentSymbols.includes(${ticker.tickerName}):`, currentSymbols.includes(ticker.tickerName));

      if (!currentSymbols.includes(ticker.primarySymbol))
        tickersToBuy.push(ticker);
      // console.info(symbolData.symbol, "data length:", candleStickData.length);
    }

    const isBuySignal = tickersToBuy.length > 0;
    // console.info("\nisBuySignal:", isBuySignal);

    const buyPrimarySymbol =
      tickersToBuy[tickersToBuy.length - 1]?.primarySymbol;
    // console.info("buyPrimarySymbol:", buyPrimarySymbol);

    const buyTickerName = tickersToBuy[0]?.tickerName;
    // console.info("buyTickerName:", buyTickerName);

    const buyPrice = tickersToBuy[0] && parseFloat(tickersToBuy[0].lastPrice);
    // console.info("buyPrice:", buyPrice);

    const buyTickerPriceChangePercent = tickersToBuy[0]?.priceChangePercent;
    // console.info("\nbuyTickerPriceChangePercent:", buyTickerPriceChangePercent);

    //
    // Sell signals
    const tickersToSell = [];

    for (const symbol of currentSymbols) {
      // const currentSymboltopListData = await gettopListData(tickerName);
      const currentSymbol = mappedList.find(
        ({ primarySymbol }) => primarySymbol === symbol
      );

      tickersToSell.push(currentSymbol);
    }

    const sellPrimarySymbol = tickersToSell[0]?.primarySymbol;
    // console.info("sellPrimarySymbol", sellPrimarySymbol);

    const sellTickerName = tickersToSell[0]?.tickerName;
    // console.info("sellTickerName:", sellTickerName);

    const sellPrice =
      tickersToSell[0] && parseFloat(tickersToSell[0].lastPrice);
    // console.info("sellPrice:", sellPrice);

    const sellTickerPriceChangePercent = tickersToSell[0]?.priceChangePercent;
    // console.info("sellTickerPriceChangePercent:", sellTickerPriceChangePercent);

    const isSellSignal = true;

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
    };

    // console.info("\naccountBalance", accountBalance);
    // console.info("\nminOrderValue", minOrderValue);

    // console.info("\ntopSymbolList", topSymbolList);
    // console.info("\ncurrentSymbols", currentSymbols);
    // console.info(
    //   "\ntickersToBuy:",
    //   tickersToBuy.map((ticker) => ticker.tickerName)
    // );
    // console.info(
    //   "\ntickersToSell:",
    //   tickersToSell.map((ticker) => ticker.tickerName)
    // );

    console.info("\nCheck signals result:", result);

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
