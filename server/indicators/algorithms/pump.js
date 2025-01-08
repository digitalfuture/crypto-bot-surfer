import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";
import { getLastPrice } from "../../api/binance/info.js";

const systemParam1 = JSON.parse(process.env.SYSTEM_PARAM_1);
const systemParam2 = JSON.parse(process.env.SYSTEM_PARAM_2);

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

    const buyTickerList = buyTickerListRaw.sort((a, b) => b.volume - a.volume);

    const buyTicker = buyTickerList[systemParam2];
    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyPrice = parseFloat(buyTicker?.lastPrice);
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;
    const tickerListUp = buyTickerList.filter(
      (item) => item.priceChangePercent > 0
    );
    const tickerListDown = buyTickerList.filter(
      (item) => item.priceChangePercent < 0
    );
    const buyCondition1 = !currentSymbol && buyTicker;
    const buyCondition2 =
      tickerListUp.length / systemParam1 > tickerListDown.length;
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
    const isSellSignal = sellCondition1 && sellCondition2;

    const marketAveragePrice = tickerList.reduce(
      (sum, { lastPrice }, idx, arr) => {
        return idx === arr.length - 1
          ? (sum + parseFloat(lastPrice) - btcUsdtPrice) / arr.length
          : sum + parseFloat(lastPrice);
      },
      0
    );

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
