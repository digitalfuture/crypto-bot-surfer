import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPrevDayData, getTradingTickers } from "../api/binance/info.js";
import { getLastPrice } from "../api/binance/info.js";

const primarySymbol = process.env.PRIMARY_SYMBOL;
const secondarySymbol = process.env.SECONDARY_SYMBOL;
const reportFileDir = process.env.REPORT_FILE_DIR;

function readSignalData() {
  const fileName = "signals.json";
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = reportFileDir
    ? path.resolve(reportFileDir)
    : path.resolve(path.dirname(__filename), "../../report");
  const filePath = path.join(__dirname, fileName);

  try {
    const fileContent = readFileSync(filePath, "utf-8");
    return JSON.parse(fileContent);
  } catch (error) {
    console.error("Error reading JSON file:", error);
    throw error;
  }
}

export async function getTradeSignals() {
  try {
    // File structure
    //
    // [
    //   {
    //     "datetime": "2023-05-07T05:12:10.156Z,28842.02",
    //     "ticker": "BTCUSDT",
    //     "signal": "BUY",
    //     "price": "50000"
    //   }
    // ]

    const signals = readSignalData();
    const { ticker, signal } = signals.reverse()[0];
    const tickerName = primarySymbol + secondarySymbol;

    // console.info("SIGNAL from file:", signal);
    // console.info("TICKER from file:", ticker);
    // console.info("");
    // console.info("TRADING TICKER:", tickerName);

    const isTradingTickerMatch = ticker === tickerName;

    if (!isTradingTickerMatch) {
      console.log(
        `Trading ticker ${tickerName} does not match with Signal ticker ${ticker}`
      );
    }

    // console.info("\nlastCheck:", lastCheck);
    // console.info("lastTrade:", lastTrade);

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
      )
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"));

    const tradingTicker = tickerList.find(
      (item) => item.primarySymbol === primarySymbol
    );

    //
    // Buy signal
    const buyPrice = tradingTicker && parseFloat(tradingTicker.lastPrice);
    const isBuySignal = signal === "BUY" && isTradingTickerMatch;

    //
    // Sell signal
    const isSellSignal = signal === "SELL" && isTradingTickerMatch;
    const sellPrice = tradingTicker && parseFloat(tradingTicker.lastPrice);

    // BTC / USDT
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    // Market average
    const marketAveragePrice = tickerList
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
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
      buyPrimarySymbol: primarySymbol,
      sellPrimarySymbol: primarySymbol,
      buyTickerName: tickerName,
      sellTickerName: tickerName,
      buyPrice,
      sellPrice,
      buyTickerPriceChangePercent: tradingTicker.priceChangePercent,
      sellTickerPriceChangePercent: tradingTicker.priceChangePercent,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketAveragePrice,
    };

    // console.info("\nCheck signals result:", {
    //   buySignal: {
    //     buyPrimarySymbol: result.buyPrimarySymbol,
    //     buyTickerName: result.buyTickerName,
    //     buyPrice: result.buyPrice,
    //     buyTickerPriceChangePercent: result.buyTickerPriceChangePercent,
    //     isBuySignal: result.isBuySignal,
    //   },
    //   sellSignal: {
    //     sellPrimarySymbol: result.sellPrimarySymbol,
    //     sellTickerName: result.sellTickerName,
    //     sellPrice: result.sellPrice,
    //     sellTickerPriceChangePercent: result.sellTickerPriceChangePercent,
    //     isSellSignal: result.isSellSignal,
    //   },
    // });

    return result;
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error, errorSrcData: error };
  }
}
