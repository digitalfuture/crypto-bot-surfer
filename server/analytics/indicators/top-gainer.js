import { getPrevDayData, getCandlestickData } from "../../api/binance/info.js";

export async function getTradeSignals({ secondarySymbol, currentTickers, accountBalance, minOrderValue }) {
  try {
    const topGainersList = await getPrevDayData();

    // console.info("topGainersList:", topGainersList);

    const mappedList = topGainersList.map(
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
    
    const topDepth = Math.floor(accountBalance / minOrderValue);

    const filteredList = mappedList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, topDepth);

    const topTickerList = filteredList.map((ticker) => ticker.tickerName);

    // Buy signals
    const tickersToBuy = [];

    for (const ticker of filteredList) {
      if (currentTickers.includes(ticker.tickerName)) continue;

      const candleStickData = await getCandlestickData({
        tickerName: ticker.tickerName,
        interval: "1d",
        periods: 3,
      });

      // console.info(symbolData.symbol, "data length:", candleStickData.length);

      const minimalLength = 1;

      if (candleStickData.length >= minimalLength) {
        tickersToBuy.push(ticker);
      }
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

    for (const tickerName of currentTickers) {
      if (topTickerList.includes(tickerName)) continue;

      const currentTickerPrevDayData = await getPrevDayData(tickerName);

      const currentTicker = currentTickerPrevDayData.map(
        ({ symbol, priceChangePercent, lastPrice, openTime, closeTime }) => ({
          primarySymbol: symbol.split(secondarySymbol)[0],
          secondarySymbol,
          tickerName: symbol,
          priceChangePercent: parseInt(priceChangePercent),
          lastPrice: parseFloat(lastPrice),
          openTime,
          closeTime,
        })
      )[0];

      tickersToSell.push(currentTicker);
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
    console.info("\ntopDepth", topDepth);

    console.info("\ntopTickerList", topTickerList);
    console.info("\nсurrentTickers", currentTickers);
    console.info("\ntickersToBuy:", tickersToBuy.map(ticker => ticker.tickerName));
    console.info("\ntickersToSell:", tickersToSell.map(ticker => ticker.tickerName));

    console.info("\nresult:", result);

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
