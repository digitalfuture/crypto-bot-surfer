import { getPrevDayData } from "../../api/binance/info.js";

export async function getTradeSignals({ secondarySymbol, currentSymbols, accountBalance, minOrderValue, minChangePercent }) {
  try {
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
      .filter(({ priceChangePercent }) => priceChangePercent >= minChangePercent)
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)

    const topSymbolList = filteredList.map((ticker) => ticker.primarySymbol);

    // Buy signals
    const tickersToBuy = [];

    for (const ticker of filteredList) {
      // console.info("ticker:", ticker);
      // console.info("ticker.primarySymbol:", ticker.primarySymbol);
      // console.info("currentSymbols:", currentSymbols);
      // console.info(`currentSymbols.includes(${ticker.tickerName}):`, currentSymbols.includes(ticker.tickerName));

      if (currentSymbols.includes(ticker.primarySymbol)) continue;

      // console.info(symbolData.symbol, "data length:", candleStickData.length);

      tickersToBuy.push(ticker);
    }

    const bestGainer = tickersToBuy[0];
    // console.info("\n\nbestGainer:", bestGainer);

    const isBuySignal = !!bestGainer;
    console.info("\nisBuySignal:", isBuySignal);

    const buyPrimarySymbol = tickersToBuy[0]?.primarySymbol
    console.info("buyPrimarySymbol:", buyPrimarySymbol);
    
    const buyTickerName = tickersToBuy[0]?.tickerName
    console.info("buyTickerName:", buyTickerName);

    const buyPrice = tickersToBuy[0] && parseFloat(tickersToBuy[0].lastPrice);
    console.info("buyPrice:", buyPrice);

    // Sell signals
    const tickersToSell = [];

    for (const symbol of currentSymbols) {
      if (topSymbolList.includes(symbol)) continue;

      // const currentSymbolPrevDayData = await getPrevDayData(tickerName);
      const currentSymbol = mappedList.find(({ primarySymbol }) => primarySymbol === symbol);

      tickersToSell.push(currentSymbol);
    }

    const isSellSignal = tickersToSell.length > 0;
    console.info("\nisSellSignal:", isSellSignal);

    const sellPrimarySymbol = tickersToSell[0]?.primarySymbol
    console.info("sellPrimarySymbol", sellPrimarySymbol);

    const sellTickerName = tickersToSell[0]?.tickerName
    console.info("sellTickerName:", sellTickerName);

    const sellPrice = tickersToSell[0] && parseFloat(tickersToSell[0].lastPrice);
    console.info("sellPrice:", sellPrice);

    const buyTickerPriceChangePercent = tickersToBuy[0]?.priceChangePercent;
    console.info("buyTickerPriceChangePercent:", buyTickerPriceChangePercent);

    const sellTickerPriceChangePercent = tickersToSell[0]?.priceChangePercent;
    console.info("sellTickerPriceChangePercent:", sellTickerPriceChangePercent);

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
    
    console.info("\naccountBalance", accountBalance);
    console.info("\nminOrderValue", minOrderValue);

    console.info("\ntopSymbolList", topSymbolList);
    console.info("\ncurrentSymbols", currentSymbols);
    console.info("\ntickersToBuy:", tickersToBuy.map(ticker => ticker.tickerName));
    console.info("\ntickersToSell:", tickersToSell.map(ticker => ticker.tickerName));

    console.info("\nresult:", result);

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
