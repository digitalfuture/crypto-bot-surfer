import { getPrevDayData, getTradingTickers } from "../../api/binance/info.js";
import { getLastPrice } from "../../api/binance/info.js";
import { report } from "../report.js";

export async function getTradeSignals({ secondarySymbol }) {
  try {
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    const tradingTickers = await getTradingTickers();
    // console.info("tradingTickers:", tradingTickers);

    const priceListData = await getPrevDayData();
    // console.info("priceListData:", priceListData);

    const filteredPriceList = priceListData
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ symbol }) => tradingTickers.includes(symbol));

    const marketAveragePrice = filteredPriceList.reduce(
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

    // const marketAveragePriceTest = filteredPriceList
    //   .slice(0, 500)
    //   .reduce((sum, { lastPrice }, index, array) => {
    //     sum = sum + parseFloat(lastPrice);

    //     if (index === array.length - 1) {
    //       return sum / array.length;
    //     } else {
    //       return sum;
    //     }
    //   }, 0);

    // console.log(
    //   "filteredPriceList:",
    //   filteredPriceList
    //     .sort((a, b) => b.lastPrice - a.lastPrice)
    //     .slice(0, 5)
    //     .map(({ lastPrice, symbol }) => ({
    //       lastPrice,
    //       symbol,
    //     }))
    // );

    // console.log("marketAveragePrice:", marketAveragePriceTest);

    //
    // Result
    const result = {
      sellPrimarySymbol: "",
      buyPrimarySymbol: "",
      sellTickerName: "",
      buyTickerName: "",
      buyPrice: 0,
      sellPrice: 0,
      buyTickerPriceChangePercent: 0,
      sellTickerPriceChangePercent: 0,
      isBuySignal: false,
      isSellSignal: false,
      btcUsdtPrice,
      passTrade: true,
    };

    report({
      date: new Date(),
      trade: "INDICATOR",
      symbol: "MARKET-CHANHGE",
      price: marketAveragePrice,
      priceChangePercent: 0,
      btcUsdtPrice,
    });

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
