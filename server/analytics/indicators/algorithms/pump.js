import {
  getPrevDayData,
  getTradingTickers,
} from "../../../api/binance/info.js";
import {
  getLastPrice,
  getMarketAverageOscillator,
} from "../../../api/binance/info.js";

const primarySymbol = process.env.PRIMARY_SYMBOL;
const systemParam1 = JSON.parse(process.env.SYSTEM_PARAM_1);

export async function getTradeSignals({
  secondarySymbol,
  currentSymbol,
  lastTrade,
  lastCheck,
}) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");
    const tradingTickers = await getTradingTickers();
    const priceListData = await getPrevDayData();

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
          volume: parseFloat(volume),
        })
      )
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      );

    const buyTickerListRaw = tickerList
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade?.symbol)
      .filter(({ primarySymbol }) => primarySymbol !== currentSymbol);

    const buyTickerList = buyTickerListRaw.sort(
      (a, b) => b.priceChangePercent - a.priceChangePercent
    );

    const buyTicker = buyTickerList.find(
      (item) => item.primarySymbol === primarySymbol
    );
    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyPrice = parseFloat(buyTicker?.lastPrice);
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;
    const buyTickerListUp = buyTickerList.filter(
      (item) => item.priceChangePercent > 0
    );

    const marketGrowLevel =
      (buyTickerListUp.length / buyTickerList.length) * 100;

    const buyCondition1 = !currentSymbol && buyTicker;
    const buyCondition2 = marketGrowLevel < systemParam1;
    const buyCondition3 = buyTicker.priceChangePercent > 0;
    const isBuySignal = buyCondition1 && buyCondition2;

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;

    const sellCondition1 = lastCheck?.symbol === currentSymbol;
    const sellCondition2 = sellPrice < lastCheck?.price;
    const isSellSignal = sellCondition1 && sellCondition2 && buyCondition3;

    const marketAveragePrice = getMarketAverageOscillator(tickerList);

    return {
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
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
