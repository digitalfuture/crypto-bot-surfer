import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";
import { getLastPrice } from "../../api/binance/info.js";

const changePercent = parseFloat(process.env.INDICATOR_CHANGE_PERCENT);
const volumeThreshold = parseFloat(process.env.INDICATOR_VOLUME_THRESHOLD);

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

    const buyTickerList = tickerList
      .filter(({ primarySymbol }) => primarySymbol !== lastTrade?.symbol)
      .filter(({ primarySymbol }) => primarySymbol !== currentSymbol)
      .filter(({ priceChangePercent, volume }) => {
        return (
          priceChangePercent > changePercent &&
          volume > volumeThreshold &&
          priceChangePercent < 30 // Исключаем слишком большие пампы
        );
      })
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, 5); // Берем топ-5 активов

    const buyTicker = buyTickerList[0]; // Берем самый перспективный
    const buyPrimarySymbol = buyTicker?.primarySymbol;
    const buyTickerName = buyTicker?.tickerName;
    const buyPrice = parseFloat(buyTicker?.lastPrice);
    const buyTickerPriceChangePercent = buyTicker?.priceChangePercent;
    const buyCondition = !currentSymbol && buyTicker;
    const isBuySignal = buyCondition;

    const tickerToSell = tickerList.find(
      ({ primarySymbol }) => primarySymbol === currentSymbol
    );

    const sellPrimarySymbol = tickerToSell?.primarySymbol;
    const sellTickerName = tickerToSell?.tickerName;
    const sellPrice = parseFloat(tickerToSell?.lastPrice) || undefined;
    const sellTickerPriceChangePercent = tickerToSell?.priceChangePercent;

    const sellCondition1 = lastCheck?.symbol === currentSymbol;
    const sellCondition2 = sellPrice < lastCheck?.price; // Если цена падает ниже последней
    const sellCondition3 = sellTickerPriceChangePercent < -5; // Падение на 5%
    const isSellSignal = sellCondition1 && (sellCondition2 || sellCondition3);

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
