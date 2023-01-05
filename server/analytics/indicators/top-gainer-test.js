import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";

export async function getTradeSignals({
  secondarySymbol,
  currentSymbols,
  minChangePercent,
  lastTrade,
}) {
  try {
    const tradingTickers = await getTradingTickers();

    // console.info("tradingTickers:", tradingTickers);
    // console.info("tradingSymbols:", tradingSymbols);

    const prevDayData = await getPrevDayData();
    // console.info("prevDayData:", prevDayData);

    const mappedList = prevDayData.map(
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
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      )
      .filter(
        ({ priceChangePercent }) => priceChangePercent >= minChangePercent
      )
      // .filter(({ primarySymbol, lastPrice }) => {
      //   if (primarySymbol === lastTrade.symbol) {
      //     return lastTrade.price < lastPrice;
      //   } else {
      //     return true;
      //   }
      // })
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent);

    //
    // Buy signals
    const tickerListToBuy = [];

    for (const ticker of filteredList) {
      // console.info("ticker:", ticker);
      // console.info("ticker.primarySymbol:", ticker.primarySymbol);
      // console.info("currentSymbols:", currentSymbols);
      // console.info(`currentSymbols.includes(${ticker.tickerName}):`, currentSymbols.includes(ticker.tickerName));

      if (!currentSymbols.includes(ticker.primarySymbol))
        tickerListToBuy.push(ticker);
      // console.info(symbolData.symbol, "data length:", candleStickData.length);
    }

    const isBuySignal = tickerListToBuy.length > 0;
    // console.info("\nisBuySignal:", isBuySignal);

    const tickerToBuy = tickerListToBuy[1];

    const buyPrimarySymbol = tickerToBuy?.primarySymbol;
    // console.info("buyPrimarySymbol:", buyPrimarySymbol);

    const buyTickerName = tickerToBuy?.tickerName;
    // console.info("buyTickerName:", buyTickerName);

    const buyPrice = tickerToBuy && parseFloat(tickerToBuy.lastPrice);
    // console.info("buyPrice:", buyPrice);

    const buyTickerPriceChangePercent = tickerToBuy?.priceChangePercent;
    // console.info("\nbuyTickerPriceChangePercent:", buyTickerPriceChangePercent);

    //
    // Sell signals
    const tickerListToSell = [];

    for (const symbol of currentSymbols) {
      // const currentSymbolPrevDayData = await getPrevDayData(tickerName);
      const currentSymbol = mappedList.find(
        ({ primarySymbol }) => primarySymbol === symbol
      );

      tickerListToSell.push(currentSymbol);
    }

    const tickerToSell = tickerListToSell[0];

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    // console.info("sellPrimarySymbol", sellPrimarySymbol);

    const sellTickerName = tickerToSell?.tickerName;
    // console.info("sellTickerName:", sellTickerName);

    const sellPrice = tickerToSell && parseFloat(tickerToSell.lastPrice);
    // console.info("sellPrice:", sellPrice);

    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;
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
    //   "\ntickerListToBuy:",
    //   tickerListToBuy.map((ticker) => ticker.tickerName)
    // );
    // console.info(
    //   "\ntickerListToSell:",
    //   tickerListToSell.map((ticker) => ticker.tickerName)
    // );

    console.info("\nCheck signals result:", result);

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
